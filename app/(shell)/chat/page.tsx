import { OperatorChatNativeAreaPanel } from "@/components/chat/operator-chat-native-area-panel"
import { OperatorChat } from "@/components/chat/operator-chat"
import { PageHeader } from "@/components/shell/page-header"

export default function ChatPage() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
      <PageHeader
        title="Operator Chat"
        description="WilliamOS command conversation for inspecting context, preparing safe next moves, and routing work without granting execution authority."
      />
      <div className="grid min-h-0 flex-1 gap-4 p-6 lg:grid-cols-[minmax(18rem,24rem)_1fr]">
        <div className="order-2 min-h-0 overflow-y-auto lg:order-1">
          <OperatorChatNativeAreaPanel />
        </div>
        <div className="order-1 min-h-0 overflow-hidden rounded-xl border border-border bg-card lg:order-2">
          <OperatorChat className="h-full" />
        </div>
      </div>
    </div>
  )
}
