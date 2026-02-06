import fs from "fs/promises";
import { Stream } from "stream";
import crypto from "crypto";
import {
  SokoArtifact,
  SokoArtifactSchema,
} from "./utils/artifacts-schemas/soko-v0";

/**
 * Local storage implementation for storing artifacts on the local filesystem.
 */
export class LocalStorage {
  public readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  /**
   * Checks if an ID exists for a given project in the local storage.
   * @param project The project name.
   * @param id The artifact ID.
   * @returns True if the ID exists, false otherwise.
   */
  public async hasId(project: string, id: string): Promise<boolean> {
    return this.exists(`${this.rootPath}/${project}/ids/${id}.json`);
  }

  /**
   * Checks if a tag exists for a given project in the local storage.
   * @param project The project name.
   * @param tag The tag name.
   * @returns True if the tag exists, false otherwise.
   */
  public async hasTag(project: string, tag: string): Promise<boolean> {
    return this.exists(`${this.rootPath}/${project}/tags/${tag}.json`);
  }

  /**
   * Lists all projects in the local storage.
   * @returns The list of project names.
   */
  public async listProjects(): Promise<string[]> {
    const entries = await fs.readdir(this.rootPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  /**
   * Lists all IDs for a given project in the local storage.
   * @param project The project name.
   * @returns The list of IDs with their last modified timestamps.
   */
  public async listIds(project: string): Promise<
    {
      id: string;
      lastModifiedAt: string;
    }[]
  > {
    const entries = await fs.readdir(`${this.rootPath}/${project}/ids`, {
      withFileTypes: true,
    });
    const ids = [];
    for (const entry of entries) {
      if (entry.isFile()) {
        ids.push(entry.name.replace(".json", ""));
      }
    }
    const statsPromises = ids.map((id) =>
      fs
        .stat(`${this.rootPath}/${project}/ids/${id}.json`)
        .then((stat) => ({ id, stat })),
    );
    const allStats = await Promise.all(statsPromises);

    return allStats.map(({ id, stat }) => ({
      id,
      lastModifiedAt: stat.mtime.toISOString(),
    }));
  }

  /**
   * Lists all tags for a given project in the local storage.
   * @param project The project name.
   * @returns The list of tags with their last modified timestamps.
   */
  public async listTags(project: string): Promise<
    {
      tag: string;
      lastModifiedAt: string;
    }[]
  > {
    const entries = await fs.readdir(`${this.rootPath}/${project}/tags`, {
      withFileTypes: true,
    });
    const tags = [];
    for (const entry of entries) {
      if (entry.isFile()) {
        tags.push(entry.name.replace(".json", ""));
      }
    }
    const statsPromises = tags.map((tag) =>
      fs
        .stat(`${this.rootPath}/${project}/tags/${tag}.json`)
        .then((stat) => ({ tag, stat })),
    );
    const allStats = await Promise.all(statsPromises);
    return allStats.map(({ tag, stat }) => ({
      tag,
      lastModifiedAt: stat.mtime.toISOString(),
    }));
  }

  /**
   * Creates an artifact associated with the given ID.
   * @param project The project name.
   * @param id The artifact ID.
   * @param artifact The artifact content.
   */
  public async createArtifactById(
    project: string,
    id: string,
    artifact: Stream,
  ): Promise<void> {
    return fs.writeFile(`${this.rootPath}/${project}/ids/${id}.json`, artifact);
  }

  /**
   * Creates an artifact associated with the given tag.
   * @param project The project name.
   * @param tag The tag name.
   * @param artifact The artifact content.
   */
  public async createArtifactByTag(
    project: string,
    tag: string,
    artifact: Stream,
  ): Promise<void> {
    return fs.writeFile(
      `${this.rootPath}/${project}/tags/${tag}.json`,
      artifact,
    );
  }

  /**
   * Retrieves the artifact associated with the given tag.
   * @param project The project name.
   * @param tag The tag name.
   * @returns The artifact.
   */
  public async retrieveArtifactByTag(
    project: string,
    tag: string,
  ): Promise<SokoArtifact> {
    const artifactContent = await fs.readFile(
      `${this.rootPath}/${project}/tags/${tag}.json`,
      "utf-8",
    );
    const rawArtifact = JSON.parse(artifactContent);
    return SokoArtifactSchema.parse(rawArtifact);
  }

  /**
   * Retrieves the artifact associated with the given ID.
   * @param project The project name.
   * @param id The artifact ID.
   * @returns The artifact.
   */
  public async retrieveArtifactById(
    project: string,
    id: string,
  ): Promise<SokoArtifact> {
    const artifactContent = await fs.readFile(
      `${this.rootPath}/${project}/ids/${id}.json`,
      "utf-8",
    );
    const rawArtifact = JSON.parse(artifactContent);
    return SokoArtifactSchema.parse(rawArtifact);
  }

  /**
   * Derives the artifact ID from the content of the artifact associated with the given tag.
   * @param project The project name.
   * @param tag The tag name.
   * @returns The derived artifact ID.
   */
  public async retrieveArtifactId(
    project: string,
    tag: string,
  ): Promise<string> {
    const artifactContent = await fs.readFile(
      `${this.rootPath}/${project}/tags/${tag}.json`,
      "utf-8",
    );
    const hash = crypto.createHash("sha256");
    hash.update(artifactContent);
    return hash.digest("hex").substring(0, 12);
  }

  /**
   * Ensures that the root path for local storage exists by creating it if necessary.
   */
  public async ensureSetup(): Promise<void> {
    const doesRootPathExist = await this.exists(this.rootPath);
    if (!doesRootPathExist) {
      await fs.mkdir(this.rootPath, { recursive: true });
    }
  }

  /**
   * Ensures that the necessary directories for a given project exist by creating them if necessary.
   * @param project The project name.
   */
  public async ensureProjectSetup(project: string): Promise<void> {
    const pathsToEnsure = [
      this.rootPath,
      `${this.rootPath}/${project}`,
      `${this.rootPath}/${project}/ids`,
      `${this.rootPath}/${project}/tags`,
    ];
    for (const path of pathsToEnsure) {
      const doesPathExist = await this.exists(path);
      if (!doesPathExist) {
        await fs.mkdir(path, { recursive: true });
      }
    }
  }

  private exists(path: string): Promise<boolean> {
    return fs
      .stat(path)
      .then(() => true)
      .catch(() => false);
  }
}
