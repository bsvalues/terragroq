import { OperatorChatNativeAreaPanel } from "@/components/chat/operator-chat-native-area-panel"
import { OperatorChat } from "@/components/chat/operator-chat"
import { PageHeader } from "@/components/shell/page-header"

export default function ChatPage() {
  return (
    <>
      <PageHeader
        title="Operator Chat"
        description="WilliamOS command conversation for inspecting context, preparing safe next moves, and routing work without granting execution authority."
      />
      <div className="px-6 py-5">
        <OperatorChatNativeAreaPanel />
      </div>
      <OperatorChat />
    </>
  )
}
