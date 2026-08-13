import{brokerContract}from'../../lib/execution-control/aegis-packaging.mjs'
export function createProtocolBroker(deps){return brokerContract(deps)}
if(import.meta.url===`file://${process.argv[1]}`){throw new Error('R3_INSTALL_AND_RUNTIME_CONFIGURATION_REQUIRED')}
