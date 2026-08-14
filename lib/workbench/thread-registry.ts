export type WorkbenchThreadRootType = "goal" | "outcome"

export type WorkbenchThreadRecord = Readonly<{
  id: string
  userId: string
  projectId: number
  title: string
  createdAt: Date
  updatedAt: Date
}>

export type WorkbenchThreadRootBinding = Readonly<{
  userId: string
  threadId: string
  sourceType: WorkbenchThreadRootType
  sourceId: string
  role: "root"
}>

export type ThreadRegistryInsertResult = "CREATED" | "THREAD_ID_CONFLICT" | "ROOT_CONFLICT"

export interface ThreadRegistryTransaction {
  projectExists(identity: Readonly<{ userId: string; projectId: number }>): Promise<boolean>
  rootSourceExists(identity: Readonly<{
    userId: string
    sourceType: WorkbenchThreadRootType
    sourceId: string
  }>): Promise<boolean>
  findRootBinding(identity: Readonly<{
    userId: string
    sourceType: WorkbenchThreadRootType
    sourceId: string
  }>): Promise<WorkbenchThreadRootBinding | null>
  findThreadById(id: string): Promise<WorkbenchThreadRecord | null>
  /**
   * Atomically inserts both records. A conflict result must leave neither
   * record inserted so the transaction can safely classify or recover it.
   */
  insertThreadWithRoot(value: Readonly<{
    thread: WorkbenchThreadRecord
    root: WorkbenchThreadRootBinding
  }>): Promise<ThreadRegistryInsertResult>
}

export interface ThreadRegistryStore {
  transaction<T>(operation: (transaction: ThreadRegistryTransaction) => Promise<T>): Promise<T>
}

export type RegisterWorkbenchThreadInput = Readonly<{
  userId: string
  projectId: number
  title: string
  root: Readonly<{
    sourceType: WorkbenchThreadRootType
    sourceId: string
  }>
}>

export type RegisterWorkbenchThreadResult = Readonly<{
  disposition: "CREATED" | "EXISTING"
  thread: WorkbenchThreadRecord
  root: WorkbenchThreadRootBinding
}>

export type ThreadRegistryErrorCode =
  | "INVALID_USER_ID"
  | "INVALID_PROJECT_ID"
  | "INVALID_TITLE"
  | "INVALID_ROOT_TYPE"
  | "INVALID_ROOT_SOURCE_ID"
  | "INVALID_GENERATED_ID"
  | "INVALID_CLOCK"
  | "PROJECT_NOT_FOUND"
  | "ROOT_SOURCE_NOT_FOUND"
  | "ROOT_USER_CONFLICT"
  | "ROOT_IDENTITY_CONFLICT"
  | "ROOT_PROJECT_CONFLICT"
  | "ROOT_BINDING_ORPHANED"
  | "ROOT_CONFLICT_UNRESOLVED"
  | "THREAD_ID_CONFLICT"

export class ThreadRegistryError extends Error {
  readonly code: ThreadRegistryErrorCode

  constructor(code: ThreadRegistryErrorCode) {
    super(code)
    this.name = "ThreadRegistryError"
    this.code = code
  }
}

type RegisterWorkbenchThreadDependencies = Readonly<{
  store: ThreadRegistryStore
  generateOpaqueId: () => string
  now?: () => Date
}>

function fail(code: ThreadRegistryErrorCode): never {
  throw new ThreadRegistryError(code)
}

function validateInput(input: RegisterWorkbenchThreadInput) {
  if (typeof input.userId !== "string" || input.userId.trim().length === 0) {
    fail("INVALID_USER_ID")
  }
  if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0) {
    fail("INVALID_PROJECT_ID")
  }
  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    fail("INVALID_TITLE")
  }
  if (input.root?.sourceType !== "goal" && input.root?.sourceType !== "outcome") {
    fail("INVALID_ROOT_TYPE")
  }
  if (typeof input.root.sourceId !== "string" || input.root.sourceId.trim().length === 0) {
    fail("INVALID_ROOT_SOURCE_ID")
  }
}

function validateExistingRoot(
  input: RegisterWorkbenchThreadInput,
  binding: WorkbenchThreadRootBinding,
) {
  if (binding.userId !== input.userId) fail("ROOT_USER_CONFLICT")
  if (
    binding.role !== "root"
    || binding.sourceType !== input.root.sourceType
    || binding.sourceId !== input.root.sourceId
  ) {
    fail("ROOT_IDENTITY_CONFLICT")
  }
}

async function recoverExisting(
  transaction: ThreadRegistryTransaction,
  input: RegisterWorkbenchThreadInput,
  binding: WorkbenchThreadRootBinding,
): Promise<RegisterWorkbenchThreadResult> {
  validateExistingRoot(input, binding)
  const thread = await transaction.findThreadById(binding.threadId)
  if (!thread || thread.id !== binding.threadId) fail("ROOT_BINDING_ORPHANED")
  if (thread.userId !== input.userId) fail("ROOT_USER_CONFLICT")
  if (thread.projectId !== input.projectId) fail("ROOT_PROJECT_CONFLICT")
  return { disposition: "EXISTING", thread, root: binding }
}

export async function registerWorkbenchThread(
  input: RegisterWorkbenchThreadInput,
  dependencies: RegisterWorkbenchThreadDependencies,
): Promise<RegisterWorkbenchThreadResult> {
  validateInput(input)

  return dependencies.store.transaction(async (transaction) => {
    const projectIdentity = { userId: input.userId, projectId: input.projectId }
    if (!await transaction.projectExists(projectIdentity)) fail("PROJECT_NOT_FOUND")

    const rootIdentity = {
      userId: input.userId,
      sourceType: input.root.sourceType,
      sourceId: input.root.sourceId,
    }
    if (!await transaction.rootSourceExists(rootIdentity)) fail("ROOT_SOURCE_NOT_FOUND")

    const existingRoot = await transaction.findRootBinding(rootIdentity)
    if (existingRoot) return recoverExisting(transaction, input, existingRoot)

    const id = dependencies.generateOpaqueId()
    if (typeof id !== "string" || id.trim().length === 0 || id !== id.trim()) {
      fail("INVALID_GENERATED_ID")
    }
    if (await transaction.findThreadById(id)) fail("THREAD_ID_CONFLICT")

    const now = (dependencies.now ?? (() => new Date()))()
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("INVALID_CLOCK")

    const thread: WorkbenchThreadRecord = {
      id,
      userId: input.userId,
      projectId: input.projectId,
      title: input.title,
      createdAt: now,
      updatedAt: now,
    }
    const root: WorkbenchThreadRootBinding = {
      userId: input.userId,
      threadId: id,
      sourceType: input.root.sourceType,
      sourceId: input.root.sourceId,
      role: "root",
    }

    const inserted = await transaction.insertThreadWithRoot({ thread, root })
    if (inserted === "CREATED") return { disposition: "CREATED", thread, root }
    if (inserted === "THREAD_ID_CONFLICT") fail("THREAD_ID_CONFLICT")

    const racedRoot = await transaction.findRootBinding(rootIdentity)
    if (!racedRoot) fail("ROOT_CONFLICT_UNRESOLVED")
    return recoverExisting(transaction, input, racedRoot)
  })
}
