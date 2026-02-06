import fs from "fs/promises";
import { toAsyncResult } from "@/utils/result";
import { CliError } from "../error";

/**
 * Given the input path, look for a build info JSON file
 *
 * This function is meant to be used in other CLI client methods, since it throws a CliError, it can be used without any wrapping, i.e.
 * ```ts
 * const buildInfoPath = await lookForBuildInfo(inputPath);
 * ```
 *
 * If the inputPath is directly a JSON file, return it.
 * If the inputPath is a directory:
 *  - if it contains a `build-info` directory, look for JSON files in it,
 *  - otherwise, look for JSON files in the inputPath directory.
 * In both cases:
 *  - if it contains a single JSON file, return that file,
 *  - if it doesn't contain any JSON file, throw an error,
 *  - if it contains multiple JSON files, throw an error.
 * @param inputPath The path to look for the build info JSON file
 * @returns The path to the build info JSON file
 * @throws A CliError
 */
export async function lookForBuildInfoJsonFile(
  inputPath: string,
  debug: boolean,
): Promise<string> {
  const statResult = await toAsyncResult(fs.stat(inputPath), { debug });
  if (!statResult.success) {
    throw new CliError(
      `The provided path "${inputPath}" does not exist or is not accessible. Please provide a valid path to a compilation artifact (build info) or a directory containing it.`,
    );
  }

  if (statResult.value.isFile()) {
    if (!inputPath.endsWith(".json")) {
      throw new CliError(
        `The provided path "${inputPath}" is a file but does not have a .json extension. Please provide a valid path to a JSON compilation artifact (build info).`,
      );
    }
    return inputPath;
  }

  if (!statResult.value.isDirectory()) {
    throw new CliError(
      `The provided path "${inputPath}" is neither a file nor a directory. Please provide a valid path to a compilation artifact (build info) or a directory containing it.`,
    );
  }

  const entriesResult = await toAsyncResult(
    fs.readdir(inputPath, { withFileTypes: true }),
    {
      debug,
    },
  );
  if (!entriesResult.success) {
    throw new CliError(
      `The provided path "${inputPath}" is a directory but could not be read. Please check the permissions and try again. Run with debug mode for more info.`,
    );
  }

  let finalEntries = entriesResult.value;
  let finalFolderPath = inputPath;

  // If it contains a `build-info` directory, look for JSON files in it
  const buildInfoDirEntry = entriesResult.value.find(
    (entry) => entry.isDirectory() && entry.name === "build-info",
  );
  if (buildInfoDirEntry) {
    const buildInfoDirPath = `${inputPath}/build-info`;
    const buildInfoEntriesResult = await toAsyncResult(
      fs.readdir(buildInfoDirPath, { withFileTypes: true }),
      { debug },
    );
    if (!buildInfoEntriesResult.success) {
      throw new CliError(
        `The "build-info" directory in the provided path "${inputPath}" could not be read. Please check the permissions and try again. Run with debug mode for more info.`,
      );
    }
    finalFolderPath = buildInfoDirPath;
    finalEntries = buildInfoEntriesResult.value;
  }

  // We consider the JSON files
  const jsonFiles = finalEntries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".json"),
  );

  if (jsonFiles.length > 1) {
    throw new CliError(
      `Multiple JSON files found in the provided path "${inputPath}". Please provide a path that contains only one JSON compilation artifact (build info).`,
    );
  }

  const targetFile = jsonFiles[0];

  if (!targetFile) {
    throw new CliError(
      `No JSON file found in the provided path "${inputPath}". Please provide a valid path to a JSON compilation artifact (build info) or a directory containing it.`,
    );
  }

  return `${finalFolderPath}/${targetFile.name}`;
}
