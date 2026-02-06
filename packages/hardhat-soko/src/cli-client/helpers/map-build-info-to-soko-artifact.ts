import {
  SokoArtifact,
  SokoArtifactSchema,
} from "@/utils/artifacts-schemas/soko-v0";
import fs from "fs/promises";
import { CliError } from "../error";
import { toAsyncResult, toResult } from "@/utils/result";
import { HardhatCompilerOutputSchema } from "@/utils/artifacts-schemas/hardhat-v2";
import {
  FORGE_COMPILER_DEFAULT_OUTPUT_FORMAT,
  ForgeCompilerContractOutputSchema,
  ForgeCompilerDefaultOutputSchema,
  ForgeCompilerOutputWithBuildInfoOptionSchema,
} from "@/utils/artifacts-schemas/forge-v1";
import { deriveSokoArtifactId } from "@/utils/derive-soko-artifact-id";
import z from "zod";
import path from "path";
import { SettingsSchema } from "@/utils/artifacts-schemas/solc-v0.8.33/input-json";
import {
  SolcContractSchema,
  SolcJsonOutputSchema,
} from "@/utils/artifacts-schemas/solc-v0.8.33/output-json";

/**
 * Given a path to a candidate build info JSON file, try to output a SokoArtifact.
 *
 * This function is meant to be used in other CLI client methods, since it throws a CliError, it can be used without any wrapping, i.e.
 * ```ts
 * const sokoArtifact = await mapBuildInfoToSokoArtifact(buildInfoPath);
 * ```
 *
 * This function will parse the build info JSON file in the different supported formats, if a format is detected, it will be mapped to the SokoArtifact format.
 * If not format is detected, an error is thrown. If the mapping fails, an error is thrown.
 *
 * @param buildInfoPath The candidate build info JSON file path to parse and map to a SokoArtifact
 * @param debug Whether to enable debug logging
 * @return The SokoArtifact mapped from the build info JSON file
 * @throws A CliError if the file cannot be parsed, if the format is not detected or if the mapping fails
 */
export async function mapBuildInfoToSokoArtifact(
  buildInfoPath: string,
  debug: boolean,
): Promise<{ artifact: SokoArtifact; additionalArtifactsPaths: string[] }> {
  const buildInfoContentResult = await toAsyncResult(
    fs.readFile(buildInfoPath, "utf-8"),
    { debug },
  );
  if (!buildInfoContentResult.success) {
    throw new CliError(
      `The provided build info path "${buildInfoPath}" could not be read. Please check the permissions and try again. Run with debug mode for more info.`,
    );
  }

  const jsonContentResult = await toResult(
    () => JSON.parse(buildInfoContentResult.value),
    { debug },
  );
  if (!jsonContentResult.success) {
    throw new CliError(
      `The provided build info file "${buildInfoPath}" could not be parsed as JSON. Please provide a valid JSON file. Run with debug mode for more info.`,
    );
  }

  // We try Hardhat V2 format first
  const hardhatV2ParsingResult = HardhatCompilerOutputSchema.safeParse(
    jsonContentResult.value,
  );
  if (hardhatV2ParsingResult.success) {
    // The parsing is successful, we can map it to the SokoArtifact format
    return {
      artifact: {
        id: deriveSokoArtifactId(hardhatV2ParsingResult.data.output),
        origin: {
          id: hardhatV2ParsingResult.data.id,
          _format: hardhatV2ParsingResult.data._format,
        },
        solcLongVersion: hardhatV2ParsingResult.data.solcLongVersion,
        input: hardhatV2ParsingResult.data.input,
        output: hardhatV2ParsingResult.data.output,
      },
      additionalArtifactsPaths: [],
    };
  }

  // We try the Foundry format with the build info option (which includes the input and output)
  const forgeCompleteBuildInfoParsingResult =
    ForgeCompilerOutputWithBuildInfoOptionSchema.safeParse(
      jsonContentResult.value,
    );
  if (forgeCompleteBuildInfoParsingResult.success) {
    return {
      artifact: {
        id: deriveSokoArtifactId(
          forgeCompleteBuildInfoParsingResult.data.output,
        ),
        origin: {
          id: forgeCompleteBuildInfoParsingResult.data.id,
          _format: forgeCompleteBuildInfoParsingResult.data._format,
        },
        solcLongVersion:
          forgeCompleteBuildInfoParsingResult.data.solcLongVersion,
        input: forgeCompleteBuildInfoParsingResult.data.input,
        output: forgeCompleteBuildInfoParsingResult.data.output,
      },
      additionalArtifactsPaths: [],
    };
  }

  // We try the Foundry format without the build info option
  const forgeDefaultBuildInfoParsingResult =
    ForgeCompilerDefaultOutputSchema.safeParse(jsonContentResult.value);
  if (forgeDefaultBuildInfoParsingResult.success) {
    // The mapping is not straightforward as we need to reconstruct the input and output from the scattered contract pieces
    const mappingResult = await toAsyncResult(
      forgeDefaultBuildInfoToSokoArtifact(
        buildInfoPath,
        forgeDefaultBuildInfoParsingResult.data,
        debug,
      ),
      { debug },
    );
    if (!mappingResult.success) {
      throw new CliError(
        `The provided build info file "${buildInfoPath}" seems to be in the Foundry default format but we failed to validate it, please try to build with the "--build-info" option or file an issue with the error details.`,
      );
    }
    return {
      artifact: mappingResult.value.artifact,
      additionalArtifactsPaths: mappingResult.value.additionalArtifactsPaths,
    };
  }

  // No format has been detected, we try to guide the user as much as possible
  const isProbablyForgeOutput =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (jsonContentResult.value as any)["source_id_to_path"] !== undefined;
  if (isProbablyForgeOutput) {
    throw new CliError(
      `The provided build info file "${buildInfoPath}" seems to be in a Foundry format, but it does not match any of the supported Foundry formats. Try to build with the following options "--skip test --skip script --force --build-info". If the problem persists, please file an issue with the build info JSON file content and the command used to generate it.`,
    );
  }

  const isProbablyHardhatOutput =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (jsonContentResult.value as any)["format"] &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (jsonContentResult.value as any)["format"].startsWith("hh");
  if (isProbablyHardhatOutput) {
    throw new CliError(
      `The provided build info file "${buildInfoPath}" seems to be in a Hardhat format, but it does not match any of the supported Hardhat formats. If the problem persists, please file an issue with the build info JSON file content and the command used to generate it.`,
    );
  }

  throw new CliError(
    `The provided build info file "${buildInfoPath}" does not match any of the supported formats. Please provide a valid build info JSON file. Run with debug mode for more info.`,
  );
}

/**
 * The default Forge build info format splits the contract output into multiple files, the build info file contains only the mapping to these files.
 *
 * The organisation of the files is the following:
 * - build-info/
 *    - <build-info-id>.json (contains the mapping to the contract output files)
 * - <file-name-0.sol>:
 *   - <contract-name>.json (contains the output for the contract)
 * - <file-name-1.sol>:
 *   - <contract-name>.json (contains the output for the contract)
 * - ...
 *
 * To reconstruct the SokoArtifact, we need to read the build info file, then read all the contract output files, and reconstruct the input and output in the SokoArtifact format.
 *
 * For this:
 * - we place ourselves in the root folder (one level above the build-info folder),
 * - we recursively look for all the .json files (except the one in the build-info folder), each of them corresponds to a contract output, for each of them:
 *  - we look for the .json files, each of them corresponds to a contract output, for each of them:
 *    - we parse the content, we reconstruct the output and input parts
 * At the end, we compare the contracts we explored with the mapping in the build info file, if they match, we can be confident that we reconstructed the input and output correctly, and we can return the SokoArtifact.
 * @param buildInfoPath The path to the Forge build info JSON file (the one in the build-info folder)
 * @param forgeBuildInfo The parsed content of the Forge build info JSON file
 */
async function forgeDefaultBuildInfoToSokoArtifact(
  buildInfoPath: string,
  forgeBuildInfo: z.infer<typeof ForgeCompilerDefaultOutputSchema>,
  debug: boolean,
): Promise<{ artifact: SokoArtifact; additionalArtifactsPaths: string[] }> {
  const expectedContractPaths = new Set(
    Object.values(forgeBuildInfo.source_id_to_path),
  );
  if (expectedContractPaths.size === 0) {
    throw new Error("Empty build info file");
  }

  const buildInfoFolder = path.dirname(buildInfoPath);
  const rootArtifactsFolder = path.dirname(buildInfoFolder);

  // We keep track of the additional artifacts paths to return them at the end
  const additionalArtifactsPaths: string[] = [];

  const exploredContractPaths = new Set<string>();
  let solcLongVersion: string | undefined = undefined;
  // Target input libraries are formatted as
  // "sourceFile" -> "libraryName" -> "libraryAddress"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputLibraries: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputSources: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outputContracts: Record<string, any> = {};
  for await (const contractArtifactPath of lookForContractArtifactPath(
    rootArtifactsFolder,
  )) {
    additionalArtifactsPaths.push(contractArtifactPath);

    const contractContentResult = await toAsyncResult(
      fs.readFile(contractArtifactPath, "utf-8").then((content) => {
        const rawParsing = JSON.parse(content);
        return ForgeCompilerContractOutputSchema.parse(rawParsing);
      }),
      { debug },
    );
    if (!contractContentResult.success) {
      if (debug) {
        console.warn(
          `Failed to parse contract artifact at path "${contractArtifactPath}". Skipping it. Error: ${contractContentResult.error}`,
        );
      }
      continue;
    }
    const contract = contractContentResult.value;

    if (!solcLongVersion) {
      solcLongVersion = contract.metadata.compiler.version;
    }

    const compilationTargetEntries = Object.entries(
      contract.metadata.settings.compilationTarget || {},
    );
    const targetEntry = compilationTargetEntries.at(0);
    if (!targetEntry || compilationTargetEntries.length > 1) {
      if (debug) {
        console.warn(
          `No compilation target found or too many targets for contract "${contractArtifactPath}". Skipping it.`,
        );
      }
      continue;
    }
    // E.g "contracts/MyContract.sol" and "MyContract"
    const [contractPath, contractName] = targetEntry;

    // Fill the input language if not set
    if (!input.language) {
      input.language = contract.metadata.language;
    }
    // Fill the input settings if not set
    if (!input.settings) {
      // Libraries in contract
      input.settings = {
        remappings: contract.metadata.settings.remappings,
        optimizer: contract.metadata.settings.optimizer,
        evmVersion: contract.metadata.settings.evmVersion,
        eofVersion: contract.metadata.settings.eofVersion,
        viaIR: contract.metadata.settings.viaIR,
        metadata: contract.metadata.settings.metadata,
        outputSelection: undefined, // not handled
        modelChecker: undefined, // not handled
      } satisfies z.infer<typeof SettingsSchema>;
    }
    // Update the input settings libraries with the libraries found in the contract metadata
    const contractLibraries = contract.metadata.settings.libraries;
    if (contractLibraries) {
      for (const fullyQualifiedPath in contractLibraries) {
        const [filePath, libraryName] = fullyQualifiedPath.split(":");
        if (!filePath || !libraryName) {
          continue;
        }
        if (!inputLibraries[filePath]) {
          inputLibraries[filePath] = {};
        }
        inputLibraries[filePath][libraryName] =
          contractLibraries[fullyQualifiedPath];
      }
    }
    // Update the input sources with the source found in the contract metadata
    for (const sourcePath in contract.metadata.sources) {
      inputSources[sourcePath] = {
        ...inputSources[sourcePath],
        ...contract.metadata.sources[sourcePath],
      };
    }

    // Fill the output contracts
    if (!outputContracts[contractPath]) {
      outputContracts[contractPath] = {};
    }
    outputContracts[contractPath][contractName] = {
      abi: contract.abi,
      metadata: contract.rawMetadata,
      userdoc: contract.metadata.output.userdoc,
      devdoc: contract.metadata.output.devdoc,
      ir: undefined, // not handled
      irAst: undefined, // not handled
      irOptimized: undefined, // not handled
      irOptimizedAst: undefined, // not handled
      storageLayout: undefined, // not handled
      transientStorageLayout: undefined, // not handled
      evm: {
        assembly: undefined, // not handled
        legacyAssembly: undefined, // not handled
        bytecode: contract.bytecode,
        deployedBytecode: contract.deployedBytecode,
        methodIdentifiers: contract.methodIdentifiers,
        gasEstimates: undefined, // not handled
      },
    } satisfies z.infer<typeof SolcContractSchema>;

    exploredContractPaths.add(contractPath);
  }

  if (exploredContractPaths.size !== expectedContractPaths.size) {
    throw new Error(
      `The number of explored contract paths (${exploredContractPaths.size}) does not match the number of expected contract paths (${expectedContractPaths.size}). Explored contract paths: ${[
        ...exploredContractPaths,
      ].join(
        ", ",
      )}. Expected contract paths: ${[...expectedContractPaths].join(", ")}.`,
    );
  }

  input.settings.libraries = inputLibraries;
  input.sources = inputSources;

  const output = {
    errors: undefined, // not handled
    sources: undefined, // not handled
    contracts: outputContracts,
  } satisfies z.infer<typeof SolcJsonOutputSchema>;

  const sokoArtifact = {
    id: deriveSokoArtifactId(output),
    solcLongVersion,
    origin: {
      id: forgeBuildInfo.id,
      _format: FORGE_COMPILER_DEFAULT_OUTPUT_FORMAT,
    },
    input,
    output,
  };

  const sokoArtifactResult = SokoArtifactSchema.safeParse(sokoArtifact);
  if (!sokoArtifactResult.success) {
    throw new Error(
      `Failed to parse the reconstructed SokoArtifact from the Forge build info default format. Error: ${sokoArtifactResult.error}`,
    );
  }

  return {
    artifact: sokoArtifactResult.data,
    additionalArtifactsPaths,
  };
}

async function* lookForContractArtifactPath(
  path: string,
): AsyncIterable<string> {
  const entries = await fs.readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== "build-info") {
      yield* lookForContractArtifactPath(`${path}/${entry.name}`);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      yield `${path}/${entry.name}`;
    }
  }
}
