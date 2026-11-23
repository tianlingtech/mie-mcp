import { createRequire } from "node:module";
import { z } from "zod";

const PackageMetadataSchema = z.object({
  version: z.string().min(1),
});

const require = createRequire(import.meta.url);
const packageMetadata = PackageMetadataSchema.parse(require("../package.json"));

export const PACKAGE_VERSION = packageMetadata.version;
