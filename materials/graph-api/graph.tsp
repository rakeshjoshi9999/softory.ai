import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

/** Record what the factory built and who consumes it. */
@service(#{ title: "Graph API" })
@info(#{ version: "1.0.0" })
@server("http://localhost:3000", "Local graph service")
namespace Factory.Graph;

/** Lifecycle state of a material version. */
enum VersionState {
  draft,
  released,
  deprecated,
  recalled,
}

/** An in-toto Statement v1 carrying a SLSA provenance v1 predicate, as written by `factory release`. */
model ProvenanceStatement {
  /** Statement type; must be https://in-toto.io/Statement/v1. */
  `_type`: string;

  /** Predicate type; must be https://slsa.dev/provenance/v1. */
  predicateType: string;

  /** Attested artifacts; the first is the package tarball. */
  @minItems(1)
  subject: Record<unknown>[];

  /** SLSA provenance predicate. */
  predicate: Record<unknown>;
}

/** What was recorded from a provenance statement. */
model ProvenanceIngested {
  /** Package name and version, e.g. `@factory/orders-api-nest@1.0.1`. */
  `package`: string;

  /** Material the package was emitted from. */
  material: string;

  /** Material version. */
  version: string;
}

/** A product's resolved factory packages for one build. */
model LockfileIngest {
  /** Product name. */
  @minLength(1)
  product: string;

  /** Build id, e.g. a short git SHA. */
  @minLength(1)
  build: string;

  /** Package name to pinned version. */
  packages: Record<string>;
}

/** What was recorded from a product lockfile. */
model LockfileIngested {
  /** Product name. */
  product: string;

  /** Build id. */
  build: string;

  /** Material versions consumed, as `<material>@<version>`. */
  consumed: string[];
}

/** One product build consuming a material version through one package. */
model Consumer {
  /** Product name. */
  product: string;

  /** Build id. */
  build: string;

  /** Package name and version consumed. */
  `package`: string;
}

/** State of a material version. */
model VersionInfo {
  /** Material name. */
  material: string;

  /** Material version. */
  version: string;

  /** Current state; `released` unless set. */
  state: VersionState;

  /** Why the state was set; always present for recalled versions. */
  reason?: string;
}

/** Request to change a version's state. */
model StateChange {
  /** New state. */
  state: VersionState;

  /** Why; required when recalling. */
  @minLength(1)
  reason?: string;
}

/** Error body returned for 4xx responses. */
@error
model Problem {
  /** Machine-readable error code. */
  code: string;

  /** Human-readable explanation. */
  message: string;
}

/** Returned when the material version is not in the graph. */
model NotFound {
  @statusCode statusCode: 404;
  @body body: Problem;
}

/** Returned when the request body is invalid. */
model BadRequest {
  @statusCode statusCode: 400;
  @body body: Problem;
}

@route("/ingest")
@tag("Ingest")
interface Ingest {
  /** Record a package and its material version from a provenance statement. */
  @post
  @route("/provenance")
  @operationId("ingestProvenance")
  provenance(@body statement: ProvenanceStatement): ProvenanceIngested | BadRequest;

  /** Record the factory packages a product build consumes. */
  @post
  @route("/lockfile")
  @operationId("ingestLockfile")
  lockfile(@body lockfile: LockfileIngest): LockfileIngested | BadRequest;
}

@route("/materials/{name}/versions/{version}")
@tag("Versions")
interface Versions {
  /** Get a material version's lifecycle state. */
  @get
  @operationId("getVersion")
  get(@path name: string, @path version: string): VersionInfo | NotFound;

  /** List every product build consuming the material version. */
  @get
  @route("/consumers")
  @operationId("listConsumers")
  consumers(@path name: string, @path version: string): Consumer[] | NotFound;

  /** Set a material version's lifecycle state. */
  @put
  @route("/state")
  @operationId("setVersionState")
  setState(@path name: string, @path version: string, @body change: StateChange): VersionInfo | BadRequest | NotFound;
}
