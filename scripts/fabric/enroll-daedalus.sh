#!/usr/bin/env bash
# Run locally on DAEDALUS as root. Public material only; no sudo grant is added.
set -euo pipefail
usage() { echo "Usage: $0 --public-key FILE [--install-openssh]" >&2; }
key_file='' install_ssh=false
while (($#)); do
  case "$1" in
    --public-key) (($# >= 2)) || { usage; exit 2; }; key_file=$2; shift 2 ;;
    --install-openssh) install_ssh=true; shift ;;
    *) usage; exit 2 ;;
  esac
done
[[ $EUID == 0 && -n $key_file && -f $key_file ]] || { usage; echo 'Root and a public key file are required.' >&2; exit 2; }
node_name=$(hostname -s | tr '[:upper:]' '[:lower:]')
[[ $node_name == daedalus || $node_name == daedalus-thinkstation-p620 ]] || { echo 'Not a DAEDALUS hostname; refusing.' >&2; exit 2; }
command -v python3 >/dev/null
command -v ssh-keygen >/dev/null
# Validate the complete public key before package installation or account changes.
python3 - "$key_file" <<'PY'
import pathlib, subprocess, sys
text = pathlib.Path(sys.argv[1]).read_text().strip()
parts = text.split()
if '\n' in text or '\r' in text or len(parts) < 2 or parts[0] != 'ssh-ed25519':
    raise SystemExit('Expected one plain Ed25519 public key, without authorized_keys options.')
subprocess.run(['ssh-keygen', '-lf', sys.argv[1]], check=True)
PY
if [[ ! -x /usr/sbin/sshd ]]; then
  $install_ssh || { echo 'OpenSSH server absent; installation requires --install-openssh.' >&2; exit 2; }
  command -v apt-get >/dev/null
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y openssh-server
fi
command -v systemctl >/dev/null
getent passwd daedalus >/dev/null
# Ubuntu may need its runtime directory before sshd configuration validation.
install -d -m 0755 /run/sshd
/usr/sbin/sshd -t
effective=$(/usr/sbin/sshd -T -C user=daedalus,host=hermes,addr=192.168.88.9)
[[ $effective == *'pubkeyauthentication yes'* ]] || { echo 'Existing SSH policy disables public keys.' >&2; exit 2; }
auth_paths=$(printf '%s\n' "$effective" | awk '$1 == "authorizedkeysfile" {$1=""; print}')
[[ " $auth_paths " == *' .ssh/authorized_keys '* ]] || { echo 'Existing SSH policy uses a different authorized_keys path; refusing.' >&2; exit 2; }
python3 - "$key_file" <<'PY'
import os, pathlib, pwd, stat, sys
account = pwd.getpwnam('daedalus')
home = pathlib.Path(account.pw_dir)
if home != pathlib.Path('/home/daedalus') or home.is_symlink():
    raise SystemExit('Unexpected DAEDALUS home; refusing.')
directory = home / '.ssh'
target = directory / 'authorized_keys'
key = pathlib.Path(sys.argv[1]).read_text().strip().split()
entry = 'from="192.168.88.9",no-agent-forwarding,no-X11-forwarding,no-port-forwarding ' + ' '.join(key[:2]) + ' williamos-fabric@hermes'

# The daedalus account can replace its own ~/.ssh between validation and write; O_NOFOLLOW on the
# final component alone does not stop a symlinked parent. Anchor the whole path to verified
# directory descriptors: open the home dir, then .ssh relative to it, each O_DIRECTORY|O_NOFOLLOW,
# then open authorized_keys relative to the verified .ssh descriptor and confirm by inode.
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW

home_fd = os.open(str(home), DIR_FLAGS)
try:
    if os.fstat(home_fd).st_uid not in (0, account.pw_uid):
        raise SystemExit('Home directory has an unexpected owner; refusing.')
    try:
        ssh_fd = os.open('.ssh', DIR_FLAGS, dir_fd=home_fd)
    except FileNotFoundError:
        os.mkdir('.ssh', mode=0o700, dir_fd=home_fd)
        ssh_fd = os.open('.ssh', DIR_FLAGS, dir_fd=home_fd)
    except OSError:
        # A swapped .ssh (symlink or non-directory) fails O_DIRECTORY|O_NOFOLLOW here; refuse cleanly.
        raise SystemExit('SSH path is a symlink or unexpected type; refusing.')
    try:
        ssh_stat = os.fstat(ssh_fd)
        if not stat.S_ISDIR(ssh_stat.st_mode) or ssh_stat.st_uid not in (0, account.pw_uid):
            raise SystemExit('SSH directory has an unexpected owner or type; refusing.')
        os.fchown(ssh_fd, account.pw_uid, account.pw_gid)
        os.fchmod(ssh_fd, 0o700)
        target_fd = os.open('authorized_keys', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=ssh_fd)
        try:
            fst = os.fstat(target_fd)
            if not stat.S_ISREG(fst.st_mode) or fst.st_nlink != 1:
                raise SystemExit('Authorized keys must be a regular file without hard links.')
            existing = os.pread(target_fd, fst.st_size, 0).decode()
            matches = [line for line in existing.splitlines() if key[1] in line.split() and not line.lstrip().startswith('#')]
            if matches and (len(matches) != 1 or matches[0] != entry):
                raise SystemExit('Fabric key already has different options or duplicate entries; refusing to weaken or replace it.')
            if not matches:
                os.lseek(target_fd, 0, os.SEEK_END)
                os.write(target_fd, (('\n' if existing and not existing.endswith('\n') else '') + entry + '\n').encode())
            os.fchown(target_fd, account.pw_uid, account.pw_gid)
            os.fchmod(target_fd, 0o600)
        finally:
            os.close(target_fd)
    finally:
        os.close(ssh_fd)
finally:
    os.close(home_fd)
print('FABRIC_PUBLIC_KEY_ENROLLED')
PY
systemctl enable --now ssh
systemctl is-active --quiet ssh
echo 'SSH_ENROLLMENT_LOCAL_COMPLETE; HERMES connectivity and host-key pinning still required'
hostname
ip -brief address
python3 - <<'PY'
import hashlib, pathlib
print('machine_id_sha256=' + hashlib.sha256(pathlib.Path('/etc/machine-id').read_text().strip().encode()).hexdigest())
PY
# Use the configured host keys, rather than assuming the default is actually served.
while IFS= read -r host_key; do
  [[ -f "$host_key.pub" ]] || continue
  ssh-keygen -lf "$host_key.pub"
  cat "$host_key.pub"
done < <(printf '%s\n' "$effective" | awk '$1 == "hostkey" { print $2 }')
