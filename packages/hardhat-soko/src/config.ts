import z from "zod";

/**
 * The Soko Hardhat user configuration
 */
export type SokoHardhatUserConfig = {
  /**
   * The project name
   */
  project: string;
  /**
   * The local path in which artifacts will be pulled
   *
   * Default to `.soko`
   */
  pulledArtifactsPath?: string;
  /**
   * The local path in which typings will be generated
   *
   * Default to `.soko-typings`
   */
  typingsPath?: string;
  /**
   * Configuration of the storage where the artifacts will be stored
   *
   * Only AWS is supported for now
   */
  storageConfiguration: {
    type: "aws";
    awsRegion: string;
    awsBucketName: string;
    awsAccessKeyId: string;
    awsSecretAccessKey: string;
    awsRole?: {
      roleArn: string;
      externalId?: string;
      sessionName?: string;
      durationSeconds?: number;
    };
  };
  /**
   * Enable debug mode for all tasks
   *
   * Default to `false`
   */
  debug?: boolean;
};

export const SokoHardhatConfig = z.object({
  project: z.string().min(1),
  pulledArtifactsPath: z.string().default(".soko"),
  typingsPath: z.string().default(".soko-typings"),
  storageConfiguration: z.object({
    type: z.literal("aws"),
    awsRegion: z.string().min(1),
    awsBucketName: z.string().min(1),
    awsAccessKeyId: z.string().min(1),
    awsSecretAccessKey: z.string().min(1),
    awsRole: z
      .object({
        roleArn: z.string().min(1),
        externalId: z.string().min(1).optional(),
        sessionName: z.string().min(1).default("soko-hardhat-session"),
        durationSeconds: z.number().int().min(900).max(43200).default(3600),
      })
      .optional(),
  }),
  debug: z.boolean().default(false),
});
