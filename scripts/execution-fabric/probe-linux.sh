#!/usr/bin/env bash
set -euo pipefail

NODE_ID="${1:-}"
OUTPUT_PATH="${2:-}"
if [[ -z "$NODE_ID" ]]; then
  echo "usage: $0 <node-id> [output-path]" >&2
  exit 2
fi

python3 - "$NODE_ID" "$OUTPUT_PATH" <<'PY'
import hashlib, json, os, re, shutil, subprocess, sys
from datetime import datetime, timezone

node_id = sys.argv[1]
out_path = sys.argv[2]
observed = datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
warnings = []

def run(cmd, timeout=20, sudo=False):
    argv = cmd if isinstance(cmd, list) else ['bash','-lc',cmd]
    if sudo:
        argv = ['sudo','-n'] + argv
    try:
        p = subprocess.run(argv, text=True, capture_output=True, timeout=timeout)
        if p.returncode != 0:
            return None, (p.stderr or p.stdout).strip()
        return p.stdout.strip(), None
    except Exception as e:
        return None, str(e)

hostname, _ = run(['hostname'])
canonical_hostname = (hostname or '').strip().lower().split('.')[0]
canonical_node_ids = {'atlas': 'atlas', 'aegis': 'aegis'}
canonical_node_id = canonical_node_ids.get(canonical_hostname)
if not canonical_node_id or node_id != canonical_node_id:
    raise SystemExit(
        f'PROBE_NODE_IDENTITY_WALL hostname={hostname} requested={node_id} canonical={canonical_node_id}'
    )

machine_id = None
identity_source = None
for identity_path, source in [
    ('/etc/machine-id', 'linux-machine-id-sha256'),
    ('/sys/class/dmi/id/product_uuid', 'linux-dmi-product-uuid-sha256'),
]:
    try:
        with open(identity_path, encoding='utf-8') as f:
            candidate = f.read().strip().lower()
        if candidate:
            machine_id = candidate
            identity_source = source
            break
    except OSError:
        pass
if not machine_id:
    raise SystemExit('PROBE_MACHINE_ID_UNAVAILABLE')
machine_id_sha256 = hashlib.sha256(machine_id.encode('utf-8')).hexdigest()

os_release = {}
try:
    with open('/etc/os-release', encoding='utf-8') as f:
        for line in f:
            if '=' in line:
                k,v = line.rstrip().split('=',1)
                os_release[k] = v.strip('"')
except Exception as e:
    warnings.append(f'os-release: {e}')

cpus = []
lscpu, err = run(['lscpu','-J'])
if lscpu:
    try:
        rows = {x['field'].rstrip(':'): x['data'] for x in json.loads(lscpu).get('lscpu',[])}
        sockets = int(rows.get('Socket(s)','1') or 1)
        cps = int(rows.get('Core(s) per socket','1') or 1)
        threads_per_core = int(rows.get('Thread(s) per core','1') or 1)
        model = rows.get('Model name','unknown')
        vendor = rows.get('Vendor ID')
        for i in range(sockets):
            cpus.append({
                'id': f'cpu{i}', 'socket': str(i), 'manufacturer': vendor,
                'model': model, 'cores': cps, 'threads': cps*threads_per_core,
                'max_mhz': float(rows['CPU max MHz']) if rows.get('CPU max MHz') else None,
                'numa_node': None
            })
    except Exception as e:
        warnings.append(f'lscpu parse: {e}')
else:
    warnings.append(f'lscpu failed: {err}')

dimms = []
dmi, err = run(['dmidecode','-t','memory'], sudo=True, timeout=30)
if dmi:
    blocks = re.split(r'\n\s*Memory Device\n', '\n'+dmi)
    for block in blocks[1:]:
        def val(name):
            m = re.search(rf'^\s*{re.escape(name)}:\s*(.+)$', block, re.M)
            return m.group(1).strip() if m else None
        size = val('Size')
        if not size or size in ('No Module Installed','Unknown'):
            continue
        mult = 1
        if 'GB' in size: mult = 1024**3
        elif 'MB' in size: mult = 1024**2
        try: capacity = int(float(size.split()[0]) * mult)
        except: continue
        totalw, dataw = val('Total Width'), val('Data Width')
        def widthnum(x):
            if not x: return None
            m = re.search(r'(\d+)', x); return int(m.group(1)) if m else None
        tw, dw = widthnum(totalw), widthnum(dataw)
        speed = val('Speed'); cfg = val('Configured Memory Speed') or val('Configured Clock Speed')
        def mhz(x):
            if not x: return None
            m = re.search(r'(\d+)', x); return float(m.group(1)) if m else None
        tdetail = val('Type Detail') or ''
        dimms.append({
            'locator': val('Locator') or 'unknown', 'bank': val('Bank Locator'),
            'capacity_bytes': capacity, 'memory_type': val('Type'), 'form_factor': val('Form Factor'),
            'ecc': (tw > dw) if tw and dw else None,
            'registered': True if 'Registered' in tdetail else (False if tdetail else None),
            'configured_mhz': mhz(cfg), 'rated_mhz': mhz(speed),
            'manufacturer': val('Manufacturer'), 'part_number': val('Part Number'), 'serial': val('Serial Number')
        })
else:
    warnings.append(f'dmidecode memory unavailable (sudo -n required): {err}')

gpus = []
if shutil.which('nvidia-smi'):
    q = 'uuid,name,pci.bus_id,memory.total,driver_version,temperature.gpu,utilization.gpu'
    out, err = run(['nvidia-smi',f'--query-gpu={q}','--format=csv,noheader,nounits'])
    if out:
        for line in out.splitlines():
            p = [x.strip() for x in line.split(',')]
            try:
                gpus.append({
                    'id': f'gpu-{p[0]}','vendor':'NVIDIA','model':p[1],'pci_bus_id':p[2],'uuid':p[0],
                    'vram_bytes': int(float(p[3])*1024*1024),'driver_version':p[4],
                    'cuda_version':None,'compute_capability':None,
                    'temperature_c': float(p[5]) if p[5].replace('.','',1).isdigit() else None,
                    'utilization_percent': float(p[6]) if p[6].replace('.','',1).isdigit() else None
                })
            except Exception as e: warnings.append(f'nvidia row parse: {e}')
    elif err: warnings.append(f'nvidia-smi: {err}')

# Physical disks and filesystem relationships.
disks = []
lsblk, err = run(['lsblk','-J','-b','-O'])
if lsblk:
    try:
        data = json.loads(lsblk)
        for d in data.get('blockdevices',[]):
            if d.get('type') != 'disk': continue
            raw_capacity = int(d.get('size') or 0)
            capacity = raw_capacity if raw_capacity > 0 else None
            if capacity is None:
                warnings.append(
                    f"disk {d.get('name')}: reported non-positive capacity; retained as unknown and unschedulable"
                )
            fs = []
            for c in d.get('children') or []:
                fs.append({
                    'name': c.get('name'),'fstype':c.get('fstype'),'label':c.get('label'),'uuid':c.get('uuid'),
                    'mountpoint':c.get('mountpoint'),'size_bytes':c.get('size')
                })
            smart_overall = poh = realloc = pending = unc = None
            if shutil.which('smartctl'):
                sj, _ = run(['smartctl','-j','-a',f"/dev/{d.get('name')}"], sudo=True, timeout=25)
                if sj:
                    try:
                        s = json.loads(sj)
                        smart_overall = 'PASSED' if s.get('smart_status',{}).get('passed') else ('FAILED' if 'smart_status' in s else None)
                        poh = s.get('power_on_time',{}).get('hours')
                        attrs = {a.get('name'): a.get('raw',{}).get('value') for a in s.get('ata_smart_attributes',{}).get('table',[])}
                        realloc = attrs.get('Reallocated_Sector_Ct')
                        pending = attrs.get('Current_Pending_Sector')
                        unc = attrs.get('Offline_Uncorrectable')
                    except Exception as e: warnings.append(f"smart parse {d.get('name')}: {e}")
            disks.append({
                'id': f"disk-{d.get('name')}", 'model': d.get('model') or d.get('name'), 'serial': d.get('serial'),
                'capacity_bytes': capacity, 'transport': d.get('tran'),
                'rotational': bool(d.get('rota')) if d.get('rota') is not None else None,
                'smart_overall': smart_overall, 'power_on_hours': poh,
                'reallocated': realloc, 'pending': pending, 'uncorrectable': unc, 'filesystems': fs
            })
    except Exception as e: warnings.append(f'lsblk parse: {e}')
else: warnings.append(f'lsblk failed: {err}')

network = []
ipj, err = run(['ip','-j','address'])
if ipj:
    try:
        routes, _ = run(['ip','-j','route','show','default'])
        defaults = set()
        if routes:
            for r in json.loads(routes):
                if r.get('dev'): defaults.add(r['dev'])
        for i in json.loads(ipj):
            name = i.get('ifname')
            if name == 'lo': continue
            addrs = [x.get('local') for x in i.get('addr_info',[]) if x.get('local')]
            speed = duplex = None
            if shutil.which('ethtool'):
                eo, _ = run(['ethtool',name])
                if eo:
                    m = re.search(r'Speed:\s*(\d+)Mb/s', eo); speed = float(m.group(1)) if m else None
                    m = re.search(r'Duplex:\s*(\S+)', eo); duplex = m.group(1).lower() if m else None
            network.append({
                'id': f"nic-{i.get('ifindex')}", 'name': name, 'mac': i.get('address'),
                'state': 'up' if i.get('operstate') == 'UP' else ('down' if i.get('operstate') == 'DOWN' else 'unknown'),
                'speed_mbps': speed, 'duplex': duplex, 'addresses': addrs,
                'default_route': name in defaults
            })
    except Exception as e: warnings.append(f'network parse: {e}')
else: warnings.append(f'ip address failed: {err}')

runtimes = []
def add_runtime(id, kind, state, version=None, endpoint=None, details=None):
    runtimes.append({'id':id,'kind':kind,'version':version,'state':state,'endpoint':endpoint,'details':details or {}})

if shutil.which('docker'):
    dv, _ = run(['docker','version','--format','{{.Server.Version}}'])
    add_runtime('docker','docker','running' if dv else 'unavailable',dv)
for svc,kind in [('ssh','ssh'),('sshd','ssh')]:
    st,_=run(['systemctl','is-active',svc])
    if st: add_runtime('ssh',kind,'running' if st=='active' else 'stopped'); break
for svc in ['postgresql','redis-server','redis','mongod','mongodb']:
    st,_=run(['systemctl','is-active',svc])
    if st: add_runtime(svc,'database','running' if st=='active' else 'stopped')
fm,_ = run(['findmnt','-J','/forge'])
if fm:
    try:
        f=json.loads(fm)['filesystems'][0]
        add_runtime('forge','storage','healthy',endpoint='/forge',details={'source':f.get('source'),'fstype':f.get('fstype'),'options':f.get('options')})
    except Exception as e: warnings.append(f'findmnt forge parse: {e}')

result = {
  'schema_version':'0.1-node-probe',
  'node':{
    'id':canonical_node_id,'hostname':hostname,'observed_at':observed,
    'identity':{
      'hostname':hostname,
      'machine_id_sha256':machine_id_sha256,
      'source':identity_source,
    },
    'os':{'family':'linux','name':os_release.get('PRETTY_NAME'),'version':os_release.get('VERSION_ID')},
    'cpus':cpus,'dimms':dimms,'gpus':gpus,'disks':disks,'network':network,'runtimes':runtimes,'warnings':warnings
  },
  'evidence':{'observed_at':observed,'probe':'scripts/execution-fabric/probe-linux.sh','probe_version':'0.1','confidence':'observed'}
}
text=json.dumps(result,indent=2)
if out_path:
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path,'w',encoding='utf-8',newline='\n') as f: f.write(text+'\n')
print(text)
PY
