import z from "zod";
import { SolcJsonOutputSchema } from "./artifacts-schemas/solc-v0.8.33/output-json";
import crypto from "crypto";

/**
 * We initialize a sha256 hash.
 * For each contract in the output
 * - we update the hash with the metadata of the output,
 * We finalize the hash, encode it as hex and returns the first 12 characters as the artifact ID.
 * @param output
 */
export function deriveSokoArtifactId(
  output: z.infer<typeof SolcJsonOutputSchema>,
): string {
  const hash = crypto.createHash("sha256");
  for (const fileContractsRecord of Object.values(output.contracts)) {
    for (const contractOutput of Object.values(fileContractsRecord)) {
      hash.update(contractOutput.metadata);
    }
  }
  return hash.digest("hex").slice(0, 12);
}
