import { loadLoCoMoBenchmark } from "./adapters/locomo.js";

export const BENCHMARKS = [
  {
    id: "locomo",
    name: "LoCoMo",
    tagline: "Long-term conversational memory benchmark",
    description:
      "围绕多轮长期对话、事件摘要、observation 和问答监督构成，适合展示会话时间线、证据引用和记忆推理信号。",
    domain: "Memory Benchmark",
    viewType: "Conversation Timeline",
    datasetPath: "/locomo10.json",
    status: "ready",
    statusLabel: "Ready",
    loader: loadLoCoMoBenchmark
  },
  {
    id: "next-benchmark",
    name: "Next Benchmark",
    tagline: "Reserved integration slot",
    description:
      "预留给下一个 benchmark。新增数据集时，只需注册新条目并实现对应 adapter，无需重写主页面。",
    domain: "Future Dataset",
    viewType: "Adapter Pending",
    datasetPath: "/your-benchmark.json",
    status: "planned",
    statusLabel: "Planned",
    loader: null
  }
];

export function getBenchmarkById(id) {
  return BENCHMARKS.find((benchmark) => benchmark.id === id) || BENCHMARKS[0];
}
