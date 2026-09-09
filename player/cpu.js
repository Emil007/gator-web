/**
 * Dynamic SM83 CPU — fetch/decode/execute at runtime from the loaded ROM.
 * No ahead-of-time recompilation; ROM bytes stay in the user's browser only.
 */
import { createDecodeStep } from "./decode.js";

export function createCpu(machine) {
  const stepOne = createDecodeStep(machine);
  return {
    kind: "dynamic",
    step() {
      return stepOne();
    },
  };
}
