  import AcpClient, {
    AcpContractClient,
    AcpJobPhases,
    AcpJob
  } from '../../../src';
  import {
    BUYER_AGENT_WALLET_ADDRESS,
    SELLER_AGENT_WALLET_ADDRESS,
    WHITELISTED_WALLET_PRIVATE_KEY,
    BUYER_ENTITY_ID,
  } from './env';
  
  async function buyer() {
    const acpClient = new AcpClient({
      acpContractClient: await AcpContractClient.build(
        WHITELISTED_WALLET_PRIVATE_KEY,
        BUYER_ENTITY_ID,
        BUYER_AGENT_WALLET_ADDRESS
      ),
      onNewTask: async (job: AcpJob) => {
        console.log(`📌 任务更新: 当前阶段 ${job.phase}`);
        for (const memo of job.memos) {
          console.log('📋 Memo 内容：\n', memo.content);
        }
      },
    });
  
    const resumePrompt = `
  请对以下候选人进行背景调查，并出具详细报告（结构化分段），验证教育和工作经历，并在最后给出结论：
  
  候选人：Mourn  
  链上地址：0xAbC12345dEF67890aBcD12345Ef67890ABcdEf67  
  
  简历：  
  - 教育背景  
    • 2015‑2019 本科，清华大学 计算机科学与技术  
    • 2019‑2021 硕士，北京大学 软件工程  
  
  - 工作经历  
    • 2021‑2023 后端开发工程师，字节跳动  
      – 负责微服务架构设计，Go 语言开发  
      – 参与高并发消息推送平台项目  
    • 2023‑至今 区块链工程师，某知名 Web3 创企  
      – Solidity + Hardhat NFT 合约开发  
      – EVM 节点监控与自动化运维脚本  
  
  - 技能  
    • Go、Rust、Solidity  
    • EVM、Substrate、IPFS  
  `;
  
    const jobId = await acpClient.initiateJob(
      SELLER_AGENT_WALLET_ADDRESS,
      { prompt: resumePrompt },
      0.0001,
      undefined,
      new Date(Date.now() + 6 * 3600 * 1000)
    );
  
    console.log(`🚀 Job ${jobId} 已发起`);
  }
  
  buyer().catch(err => {
    console.error('Buyer agent 出错：', err);
    process.exit(1);
  });
  
// import AcpClient, {
//     AcpContractClient,
//     AcpJobPhases,
//     AcpJob,
//     AcpAgentSort,
//     baseSepoliaAcpConfig
// } from "../../../src";
// import {
//     BUYER_AGENT_WALLET_ADDRESS,
//     WHITELISTED_WALLET_PRIVATE_KEY,
//     BUYER_ENTITY_ID,
//     SELLER_AGENT_WALLET_ADDRESS,
// } from "./env";

// async function buyer() {
//     const acpClient = new AcpClient({
//         acpContractClient: await AcpContractClient.build(
//             WHITELISTED_WALLET_PRIVATE_KEY,
//             BUYER_ENTITY_ID,
//             BUYER_AGENT_WALLET_ADDRESS
//         ),
//         onNewTask: async (job: AcpJob) => {
//             if (
//                 job.phase === AcpJobPhases.NEGOTIATION &&
//                 job.memos.find((m) => m.nextPhase === AcpJobPhases.TRANSACTION)
//             ) {
//                 console.log("Paying job", job);
//                 await job.pay(job.price);
//                 console.log(`Job ${job.id} paid`);
//             } else if (job.phase === AcpJobPhases.COMPLETED) {
//                 console.log(`Job ${job.id} completed`);
//             } else if (job.phase === AcpJobPhases.REJECTED) {
//                 console.log(`Job ${job.id} rejected`);
//             }
//         },
//         onEvaluate: async (job: AcpJob) => {
//             console.log("Evaluation function called", job);
//             await job.evaluate(true, "Self-evaluated and approved");
//             console.log(`Job ${job.id} evaluated`);
//         },
//     });


//     const jobId = await acpClient.initiateJob(
//         SELLER_AGENT_WALLET_ADDRESS,
//               { prompt: "请为我审核报告生成质量，决定我是否应该为公司支付" },
//               0.0001,
//               undefined,
//               new Date(Date.now() + 6 * 3600 * 1000)
//             );

//     console.log(`Job ${jobId} initiated`);
// }

// buyer();