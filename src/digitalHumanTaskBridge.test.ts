import { runDigitalHumanKernelTask, type DigitalHumanTaskBridgeAdapter } from '@agi/frontend'

const adapter: DigitalHumanTaskBridgeAdapter = {
  async sendActivityThreadMessage() {
    return {
      error: {
        code: 'ACTIVITY_THREAD_REQUIRED',
        message: '桌面端需要先连接到一个活动线程',
      },
      requiresUserAction: true,
    }
  },
}

void runDigitalHumanKernelTask(
  { intent: 'desktop smoke', message: '检查状态' },
  { sessionId: 'desktop-digital-human' },
  adapter,
)
