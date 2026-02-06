import z from "zod";
import { SolcJsonInputSchema } from "./solc-v0.8.33/input-json";
import { SolcJsonOutputSchema } from "./solc-v0.8.33/output-json";

export const HARDHAT_COMPILER_OUTPUT_FORMAT = "hh-sol-build-info-1";

export const HardhatCompilerOutputSchema = z.object({
  id: z.string(),
  _format: z.literal(HARDHAT_COMPILER_OUTPUT_FORMAT),
  solcVersion: z.string().optional(),
  solcLongVersion: z.string(),
  input: SolcJsonInputSchema,
  output: SolcJsonOutputSchema,
});
