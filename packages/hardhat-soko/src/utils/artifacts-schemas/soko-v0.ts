import z from "zod";
import { SolcJsonInputSchema } from "./solc-v0.8.33/input-json";
import { SolcJsonOutputSchema } from "./solc-v0.8.33/output-json";
import {
  FORGE_COMPILER_DEFAULT_OUTPUT_FORMAT,
  FORGE_COMPILER_OUTPUT_WITH_BUILD_INFO_OPTION_FORMAT,
} from "./forge-v1";
import { HARDHAT_COMPILER_OUTPUT_FORMAT } from "./hardhat-v2";

/**
 * This is the schema for an artifact stored on Soko
 */
export const SokoArtifactSchema = z.object({
  // ID derived by Soko
  id: z.string(),
  // Origin of the artifact, can be used to revert to the original compiler output JSON structure if needed.
  origin: z.object({
    id: z.string(),
    _format: z.enum([
      FORGE_COMPILER_DEFAULT_OUTPUT_FORMAT,
      FORGE_COMPILER_OUTPUT_WITH_BUILD_INFO_OPTION_FORMAT,
      HARDHAT_COMPILER_OUTPUT_FORMAT,
    ]),
  }),
  solcLongVersion: z.string(),
  input: SolcJsonInputSchema,
  output: SolcJsonOutputSchema,
});

export type SokoArtifact = z.infer<typeof SokoArtifactSchema>;
