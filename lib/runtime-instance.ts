export function getProcessStartedAt() {
  return Math.floor(Date.now() - process.uptime() * 1000)
}

export function getRuntimeInstanceId() {
  return `${process.pid}-${getProcessStartedAt()}`
}
