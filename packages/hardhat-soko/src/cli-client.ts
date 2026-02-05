import { LocalStorage } from "./local-storage";
import { StorageProvider } from "./s3-bucket-provider";
import { StepTracker } from "./cli-ui";
import { retrieveFreshCompilationArtifact, toAsyncResult } from "./utils";

import crypto from "crypto";

/**
 * Client implementing the operations of the CLI commands, it is used by the CLI entry point but also can be used programmatically, for example in tests or scripts.
 * It is designed to be independent of the CLI entry point and can be used without any dependency on the CLI, it only requires a StorageProvider and a LocalStorage to operate.
 * Methods MUST throw CliError with user-friendly messages that can be directly shown to the user, in case of any error. This allows the CLI entry point to handle the errors in a consistent way and also allows the methods to be used in other contexts without any dependency on the CLI error handling.
 */
export class CliClient {
  private storageProvider: StorageProvider;
  private localStorage: LocalStorage;
  private debug: boolean;

  constructor(
    storageProvider: StorageProvider,
    localStorage: LocalStorage,
    opts: { debug: boolean },
  ) {
    const debug = opts.debug;

    this.debug = debug;
    this.storageProvider = storageProvider;
    this.localStorage = localStorage;
  }

  /**
   * Run the pull command of the CLI clients, it consists of four steps:
   * 1. Set up the local storage for the project
   * 2. Fetch the list of remote tags and IDs from the storage provider, and filter them based on the provided tagOrId parameter
   * 3. Check which of the filtered tags and IDs are already present in the local storage, unless the force option is enabled
   * 4. Download the missing artifacts from the storage provider and save them to the local storage
   *
   * The method returns an object containing the list of remote tags and IDs, the list of successfully pulled tags and IDs, and the list of tags and IDs that failed to be pulled.
   * @throws CliError if there is an error setting up the local storage, fetching the remote artifacts, checking the local artifacts, or downloading the artifacts. The error messages are meant to be user-friendly and can be directly shown to the user.
   * @param project The project name
   * @param tagOrId The tag or ID of the artifact to pull, if not provided all tags and IDs will be pulled
   * @param opts Options for the pull command, currently only supports the force option to skip the check of existing local artifacts
   * @returns An object with the remote tags and IDs, pulled tags and IDs, and failed tags and IDs
   *
   */
  public async pull(
    project: string,
    tagOrId: string | undefined,
    opts: { force: boolean },
  ): Promise<PullResult> {
    const steps = new StepTracker(4);

    // Step 1: Set up local storage
    steps.start("Setting up local storage...");
    const ensureResult = await toAsyncResult(
      this.localStorage.ensureProjectSetup(project),
      { debug: this.debug },
    );
    if (!ensureResult.success) {
      steps.fail("Failed to setup local storage");
      throw new CliError(
        "Error setting up local storage, is the script not allowed to write to the filesystem? Run with debug mode for more info",
      );
    }
    steps.succeed("Local storage ready");

    // Step 2: Fetch remote artifacts
    steps.start("Fetching remote artifact list...");
    const remoteListingResult = await toAsyncResult(
      Promise.all([
        this.storageProvider.listTags(project),
        this.storageProvider.listIds(project),
      ]),
      { debug: this.debug },
    );
    if (!remoteListingResult.success) {
      steps.fail("Failed to fetch remote artifacts");
      throw new CliError(
        "Error interacting with the storage, please check the configuration or run with debug mode for more info",
      );
    }
    const [remoteTags, remoteIds] = remoteListingResult.value;
    steps.succeed("Fetched remote artifact list");

    let tagsToDownload: string[];
    let idsToDownload: string[];
    if (tagOrId) {
      if (remoteTags.includes(tagOrId)) {
        tagsToDownload = [tagOrId];
        idsToDownload = [];
      } else if (remoteIds.includes(tagOrId)) {
        tagsToDownload = [];
        idsToDownload = [tagOrId];
      } else {
        steps.fail("The tag or ID does not exist in the storage");
        throw new CliError(
          `The tag or ID "${tagOrId}" does not exist in the storage`,
        );
      }
    } else {
      tagsToDownload = remoteTags;
      idsToDownload = remoteIds;
    }

    // Step 3: Check local artifacts
    steps.start("Checking local artifacts...");
    let filteredTagsToDownload: string[] = [];
    let filteredIdsToDownload: string[] = [];
    if (opts.force) {
      filteredTagsToDownload = tagsToDownload;
      filteredIdsToDownload = idsToDownload;
      steps.succeed("Local artifacts check skipped (force mode)");
    } else {
      const localListingResult = await toAsyncResult(
        Promise.all([
          this.localStorage
            .listTags(project)
            .then(
              (tagMetadatas) =>
                new Set(tagMetadatas.map((metadata) => metadata.tag)),
            ),
          this.localStorage
            .listIds(project)
            .then(
              (idMetadatas) =>
                new Set(idMetadatas.map((metadata) => metadata.id)),
            ),
        ]),
        { debug: this.debug },
      );
      if (!localListingResult.success) {
        steps.fail("Failed to check local artifacts");
        throw new CliError(
          "Error checking local storage, is the script not allowed to read from the filesystem? Run with debug mode for more info",
        );
      }

      const [localTags, localIds] = localListingResult.value;

      filteredTagsToDownload = tagsToDownload.filter(
        (tag) => !localTags.has(tag),
      );
      filteredIdsToDownload = idsToDownload.filter((id) => !localIds.has(id));
      steps.succeed("Checked local artifacts");
    }

    // Step 4: Download artifacts
    if (
      filteredTagsToDownload.length === 0 &&
      filteredIdsToDownload.length === 0
    ) {
      steps.start("Checking for updates...");
      steps.succeed("All artifacts are up to date");
      return {
        remoteTags,
        remoteIds,
        pulledTags: [],
        pulledIds: [],
        failedTags: [],
        failedIds: [],
      };
    }

    const missingArtifactCount =
      filteredTagsToDownload.length + filteredIdsToDownload.length;
    steps.start(
      `Downloading ${missingArtifactCount} missing artifact${missingArtifactCount > 1 ? "s" : ""}...`,
    );

    const tagsPromises: Promise<{ tag: string }>[] = filteredTagsToDownload.map(
      async (tag) => {
        const downloadResult = await toAsyncResult(
          this.storageProvider.downloadArtifactByTag(project, tag),
          { debug: this.debug },
        );
        if (!downloadResult.success) {
          throw new PullTagError(tag);
        }

        const createResult = await toAsyncResult(
          this.localStorage.createArtifactByTag(
            project,
            tag,
            downloadResult.value,
          ),
          { debug: this.debug },
        );
        if (!createResult.success) {
          throw new PullTagError(tag);
        }

        return { tag };
      },
    );
    const idsPromises: Promise<{ id: string }>[] = filteredIdsToDownload.map(
      async (id) => {
        const downloadResult = await toAsyncResult(
          this.storageProvider.downloadArtifactById(project, id),
          { debug: this.debug },
        );
        if (!downloadResult.success) {
          throw new PullIdError(id);
        }

        const createResult = await toAsyncResult(
          this.localStorage.createArtifactById(
            project,
            id,
            downloadResult.value,
          ),
          { debug: this.debug },
        );
        if (!createResult.success) {
          throw new PullIdError(id);
        }

        return { id };
      },
    );

    const tagsSettlements = await Promise.allSettled(tagsPromises);
    const pulledTags: string[] = [];
    const failedTags: string[] = [];
    for (const settlement of tagsSettlements) {
      if (settlement.status === "fulfilled") {
        pulledTags.push(settlement.value.tag);
      } else {
        // We know that the only possible error is PullTagError, we check for safety but we don't want any other error to be silently ignored
        if (settlement.reason instanceof PullTagError) {
          failedTags.push(settlement.reason.tag);
        } else {
          steps.fail("Failed to download artifacts");
          throw new CliError(
            "Unexpected error while pulling tags, please fill an issue",
          );
        }
      }
    }

    const idsSettlements = await Promise.allSettled(idsPromises);
    const pulledIds: string[] = [];
    const failedIds: string[] = [];
    for (const settlement of idsSettlements) {
      if (settlement.status === "fulfilled") {
        pulledIds.push(settlement.value.id);
      } else {
        // We know that the only possible error is PullIdError, we check for safety but we don't want any other error to be silently ignored
        if (settlement.reason instanceof PullIdError) {
          failedIds.push(settlement.reason.id);
        } else {
          steps.fail("Failed to download artifacts");
          throw new CliError(
            "Unexpected error while pulling IDs, please fill an issue",
          );
        }
      }
    }

    const totalPulled = pulledTags.length + pulledIds.length;
    const totalFailed = failedTags.length + failedIds.length;

    if (totalFailed > 0) {
      steps.fail(
        `Downloaded ${totalPulled} artifact${totalPulled > 1 ? "s" : ""}, ${totalFailed} failed`,
      );
    } else {
      steps.succeed(
        `Downloaded ${totalPulled} artifact${totalPulled > 1 ? "s" : ""} successfully`,
      );
    }

    return {
      remoteTags,
      remoteIds,
      pulledTags,
      pulledIds,
      failedTags,
      failedIds,
    };
  }

  /**
   * Run the push command of the CLI client, it consists of three steps:
   * 1. Read the compilation artifact from the provided path and validate it
   * 2. If a tag is provided, check if it already exists in the storage and handle it based on the force option
   * 3. Upload the artifact to the storage with the provided project, tag, and a generated ID based on the artifact content
   *
   * The method returns the generated artifact ID.
   *
   * @throws CliError if there is an error reading the artifact, checking the tag existence, or uploading the artifact. The error messages are meant to be user-friendly and can be directly shown to the user.
   * @param artifactPath The path to the compilation artifact to push
   * @param project The project name
   * @param tag The tag to associate with the artifact, if any
   * @param opts Options for the push command, currently only supports the force option to skip the check of existing tag in the storage
   * @returns The generated artifact ID
   */
  public async push(
    artifactPath: string,
    project: string,
    tag: string | undefined,
    opts: { force: boolean },
  ): Promise<string> {
    const steps = new StepTracker(3);

    // Step 1: Read compilation artifact
    steps.start("Reading compilation artifact...");
    const freshBuildInfoResult = await toAsyncResult(
      retrieveFreshCompilationArtifact(artifactPath),
      {
        debug: this.debug,
      },
    );
    if (!freshBuildInfoResult.success) {
      steps.fail("Failed to read compilation artifact");
      throw new CliError(
        "Error retrieving the compilation artifact, please check if the path contains a valid compilation artifact. Run with debug mode for more info",
      );
    }

    if (freshBuildInfoResult.value.status === "error") {
      steps.fail("Failed to read compilation artifact");
      throw new CliError(
        `Error retrieving the compilation artifact. ${freshBuildInfoResult.value.reason}`,
      );
    }
    steps.succeed("Compilation artifact read");

    // Step 2: Check if tag exists
    steps.start("Checking if tag exists...");
    if (!tag) {
      steps.succeed("No tag provided, skipping tag existence check");
    } else {
      const hasTagResult = await toAsyncResult(
        this.storageProvider.hasArtifactByTag(project, tag),
        { debug: this.debug },
      );
      if (!hasTagResult.success) {
        steps.fail("Failed to check tag existence");
        throw new CliError(
          `Error checking if the tag "${tag}" exists on the storage, please check the storage configuration or run with debug mode for more info`,
        );
      }
      if (hasTagResult.value) {
        if (!opts.force) {
          steps.fail("Tag already exists");
          throw new CliError(
            `The tag "${tag}" already exists on the storage. Please, make sure to use a different tag.`,
          );
        } else {
          steps.warn(`Tag "${tag}" already exists, forcing push`);
        }
      } else {
        steps.succeed("Tag is available");
      }
    }

    const artifactId = deriveArtifactSokoId(freshBuildInfoResult.value.content);

    // Step 3: Upload artifact
    steps.start("Uploading artifact...");
    const pushResult = await toAsyncResult(
      this.storageProvider.uploadArtifact(
        project,
        artifactId,
        tag,
        freshBuildInfoResult.value.content,
      ),
      { debug: this.debug },
    );

    if (!pushResult.success) {
      steps.fail("Failed to upload artifact");
      throw new CliError(
        `Error pushing the artifact "${project}:${tag || artifactId}" to the storage, please check the storage configuration or run with debug mode for more info`,
      );
    }
    steps.succeed("Artifact uploaded successfully");

    return artifactId;
  }

  /**
   * List the artifacts that have been pulled to the local storage, it consists of two steps:
   * 1. Fetch the list of projects, tags, and IDs from the local storage
   * 2. Structure the data in a user-friendly format for display
   *
   * The method returns an array of artifact items containing the project, tag, ID, and last modified date.
   *
   * @throws CliError if there is an error fetching the data from the local storage. The error messages are meant to be user-friendly and can be directly shown to the user.
   * @returns The list of artifacts in the local storage with their project, tag, ID, and last modified date
   */
  public async listPulledArtifacts(): Promise<ListResult> {
    const ensureResult = await toAsyncResult(this.localStorage.ensureSetup(), {
      debug: this.debug,
    });
    if (!ensureResult.success) {
      throw new CliError(
        "Error setting up local storage, is the script not allowed to write to the filesystem? Run with debug mode for more info",
      );
    }

    const projectsResult = await toAsyncResult(
      this.localStorage.listProjects(),
      {
        debug: this.debug,
      },
    );
    if (!projectsResult.success) {
      throw new CliError(
        "Error listing the projects, please run with debug mode for more info",
      );
    }

    const items: ArtifactItem[] = [];
    const idsAlreadyVisited = new Set<string>();
    const projects = projectsResult.value;
    for (const project of projects) {
      const tagsResult = await toAsyncResult(
        this.localStorage.listTags(project),
        {
          debug: this.debug,
        },
      );
      if (!tagsResult.success) {
        throw new CliError(
          `Error listing the tags for project "${project}", please force pull the project to restore it or run with debug mode for more info`,
        );
      }

      const artifactsPromises = tagsResult.value.map((metadata) =>
        this.localStorage
          .retrieveArtifactId(project, metadata.tag)
          .then((artifactId) => ({
            metadata,
            artifactId,
          })),
      );
      const artifactsResults = await toAsyncResult(
        Promise.all(artifactsPromises),
        { debug: this.debug },
      );
      if (!artifactsResults.success) {
        throw new CliError(
          `Error retrieving the content for project "${project}", please force pull the project to restore it or run with debug mode for more info`,
        );
      }

      for (const { metadata, artifactId } of artifactsResults.value) {
        items.push({
          project,
          id: artifactId,
          tag: metadata.tag,
          lastModifiedAt: metadata.lastModifiedAt,
        });
        idsAlreadyVisited.add(artifactId);
      }

      const idsResult = await toAsyncResult(
        this.localStorage.listIds(project),
        {
          debug: this.debug,
        },
      );
      if (!idsResult.success) {
        throw new CliError(
          `Error listing the IDs for project "${project}", please force pull the project to restore it or run with debug mode for more info`,
        );
      }
      for (const metadata of idsResult.value) {
        if (idsAlreadyVisited.has(metadata.id)) {
          continue;
        }
        items.push({
          project: project,
          id: metadata.id,
          tag: null,
          lastModifiedAt: metadata.lastModifiedAt,
        });
        idsAlreadyVisited.add(metadata.id);
      }
    }
    return items;
  }
}

export type PullResult = {
  remoteTags: string[];
  remoteIds: string[];
  pulledTags: string[];
  pulledIds: string[];
  failedTags: string[];
  failedIds: string[];
};

export type ListResult = Array<ArtifactItem>;

type ArtifactItem = {
  project: string;
  id: string;
  tag: string | null;
  lastModifiedAt: string;
};

function deriveArtifactSokoId(artifactContent: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(artifactContent);
  const checksum = hash.digest("hex");
  return checksum.substring(0, 12);
}

class PullTagError extends Error {
  public tag: string;
  constructor(tag: string) {
    super(`Error pulling the tag "${tag}"`);
    this.tag = tag;
  }
}

class PullIdError extends Error {
  public id: string;
  constructor(id: string) {
    super(`Error pulling the ID "${id}"`);
    this.id = id;
  }
}

/**
 * Custom error class for CLI errors.
 * Message is meant to be user-friendly and can be directly shown to the user.
 */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
  }
}
