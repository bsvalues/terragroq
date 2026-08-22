import{createHash}from'node:crypto'
export async function hashVerifyOnly(chunks){const h=createHash('sha256');let bytes=0;for await(const x of chunks){if(!(x instanceof Uint8Array))throw new Error('HASH_CHILD_INPUT_INVALID');bytes+=x.length;h.update(x)}return Object.freeze({digest:'sha256:'+h.digest('hex'),bytes})}
if(import.meta.url===`file://${process.argv[1]}`){throw new Error('TRANSIENT_NO_SOCKET_SCOPE_REQUIRED')}
