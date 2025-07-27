// scripts/seller.ts

import AcpClient, {
  AcpContractClient,
  AcpJobPhases,
  AcpJob
} from '../../../src';

import {
  SELLER_AGENT_WALLET_ADDRESS,
  SELLER_ENTITY_ID,
  WHITELISTED_WALLET_PRIVATE_KEY
} from './env';

import {
  DummyBackgroundCheckAgent
} from './agent/backgroundagent';

async function seller() {
  const acpContractClient = await AcpContractClient.build(
    WHITELISTED_WALLET_PRIVATE_KEY,
    SELLER_ENTITY_ID,
    SELLER_AGENT_WALLET_ADDRESS
  );

  const agent = new DummyBackgroundCheckAgent();

  new AcpClient({
    acpContractClient,
    onNewTask: async (job: AcpJob) => {
      if (job.phase === AcpJobPhases.REQUEST) {
        const ctx = job.context as Record<string, any> | null;
        const prompt = typeof ctx?.prompt === 'string' ? ctx.prompt : '';
        console.log('[REQUEST] 收到任务，prompt 长度：', prompt.length);

        const { passed, report } = await agent.run(prompt);
        await job.respond(passed, report);
        console.log('[REQUEST] respond 完成，report 已发送');
      }
    }
  });
}

seller().catch(console.error);
