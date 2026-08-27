import { admitW1LocalFixtureRequest } from "@/lib/environment/w1-local-fixture"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!admitW1LocalFixtureRequest(request)) return new Response("NOT_FOUND", { status: 404 })
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#11161b;color:#d8dde3;font:14px system-ui}.card{max-width:32rem;padding:2rem;border:1px solid #34404a;border-radius:14px;background:#171d23}button{padding:.6rem 1rem;border:1px solid #7f5b3f;border-radius:8px;background:#281e18;color:#f0c49e;cursor:pointer}.label{color:#e5b98f;font-size:11px;letter-spacing:.12em}.count{font-variant-numeric:tabular-nums}</style></head>
<body><main class="card"><p class="label">TERRAFUSION · W1 INTERACTION FIXTURE</p><h1>Running surface stays interactive</h1><p>This bounded local surface proves the window remains usable beside real file editing. It is not a production TerraFusion runtime.</p><button id="pulse" type="button">Run fixture action</button> <span class="count" id="count">0 actions</span></main>
<script>let count=0;document.getElementById('pulse').addEventListener('click',()=>{count+=1;document.getElementById('count').textContent=count+' action'+(count===1?'':'s')})</script></body></html>`, {
    headers: { "cache-control": "no-store", "content-type": "text/html; charset=utf-8" },
  })
}
