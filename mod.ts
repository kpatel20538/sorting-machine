import { parse as tomlParse } from "https://deno.land/std@0.154.0/encoding/toml.ts";
import { parse as flagParse } from "https://deno.land/std@0.154.0/flags/mod.ts";
import { expandGlob } from "https://deno.land/std@0.154.0/fs/mod.ts";
import {
  globToRegExp,
  parse as pathParse,
  resolve,
} from "https://deno.land/std@0.154.0/path/mod.ts";
import chalk from "https://deno.land/x/chalkin@v0.1.3/mod.ts";
import { render } from "https://deno.land/x/mustache@v0.3.0/mod.ts";
import format from "https://esm.sh/date-fns@2.29.1/format";
import {
  object,
  array,
  string,
  optional,
  record,
  type,
  create,
  boolean,
  defaulted,
  Infer,
  intersection,
} from "https://esm.sh/superstruct@0.16.0";

const Options = object({
  defaultPaths: array(string()),
});

const Conversion = object({
  cmd: array(string()),
});

type Conversion = Infer<typeof Conversion>;

const Strategy = object({
  type: string(),
  input: string(),
  output: string(),
  convert: optional(string()),
});

type Strategy = Infer<typeof Strategy>;

const Config = object({
  options: Options,
  conversions: record(string(), Conversion),
  strategies: array(Strategy),
});

type Config = Infer<typeof Config>;

const OperationFlags = type({
  dryRun: defaulted(boolean(), () => false),
});

type OperationFlags = Infer<typeof OperationFlags>;

const Flags = intersection([
  OperationFlags,
  type({
    help: defaulted(boolean(), () => false),
    overrideConfigPath: optional(string()),
    _: array(string()),
  }),
]);

type BaseModel = {
  CWD: string;
  HOME: string;
};

type Context = {
  config: Config;
  flags: OperationFlags;
  model: BaseModel;
};

async function fileExists(target: string): Promise<boolean> {
  try {
    await Deno.stat(target);
    return true;
  } catch {
    return false;
  }
}

function formatDate(date: Date | null): string {
  return format(date ?? null, "yy-MM-dd_HH-mm-SS");
}

type ConversionModel = BaseModel & {
  SOURCE: string;
  TARGET: string;
};

async function executeConversion({ cmd }: Conversion, model: ConversionModel) {
  const process = Deno.run({
    cmd: cmd.map((template) => render(template, model)),
  });

  const status = await process.status();

  if (status.success) {
    await Deno.remove(model.SOURCE);
  } else {
    throw new Error("Conversion failed");
  }
}

type TargetModel = BaseModel & {
  DIRECTORY: string;
  BASENAME: string;
  FILENAME: string;
  EXTENSION: string;
  CREATION_TIME: string;
  ACCESS_TIME: string;
  MODIFICATION_TIME: string;
};

async function resolveTarget(
  output: string,
  model: TargetModel,
  source: string
): Promise<string | null> {
  let target = resolve(render(output, model));
  const { dir, name, ext } = pathParse(target);
  if (source === target) {
    return null;
  }

  for (let i = 1; await fileExists(target); i++) {
    target = resolve(dir, `${name} (${i})${ext}`);
  }

  return target;
}

async function executeStrategy(
  context: Context,
  strategy: Strategy,
  source: string
) {
  const sourcePath = pathParse(source);
  const sourceInfo = await Deno.stat(source);
  const target = await resolveTarget(
    strategy.output,
    {
      ...context.model,
      DIRECTORY: sourcePath.dir,
      BASENAME: sourcePath.name,
      FILENAME: sourcePath.base,
      EXTENSION: sourcePath.ext,
      CREATION_TIME: formatDate(sourceInfo.birthtime),
      ACCESS_TIME: formatDate(sourceInfo.atime),
      MODIFICATION_TIME: formatDate(sourceInfo.mtime),
    },
    source
  );

  if (target === null) {
    console.log(
      `${chalk.bold.yellow("SKIPPING")} ${chalk.italic(
        strategy.type
      )}: ${source}`
    );
    return;
  } else {
    console.log(
      `${chalk.bold.green("CONVERTING")} ${chalk.italic(
        strategy.type
      )}: ${source} -> ${target}`
    );
  }

  if (!context.flags.dryRun) {
    try {
      const conversion = strategy.convert
        ? context.config.conversions[strategy.convert]
        : null;
      if (conversion) {
        await executeConversion(conversion, {
          ...context.model,
          SOURCE: source,
          TARGET: target,
        });
      } else {
        await Deno.rename(source, target);
      }
    } catch {
      console.error(
        `${chalk.red("FAILED")} ${chalk.cyan(
          strategy.type
        )}: ${source} -> ${target}`
      );
    }
  }
}

async function sortDirectory(context: Context, directory: string) {
  const visited = new Set();
  for (const strategy of context.config.strategies) {
    const fileWalk = expandGlob(resolve(directory, strategy.input), {
      caseInsensitive: true,
      includeDirs: false,
      extended: true,
    });
    for await (const entry of fileWalk) {
      if (!visited.has(entry.path)) {
        await executeStrategy(context, strategy, entry.path);
        visited.add(entry.path);
      }
    }
  }
}

async function sortFile(context: Context, file: string) {
  const fullPath = resolve(file);
  const { dir } = pathParse(fullPath);
  for (const strategy of context.config.strategies) {
    const pattern = globToRegExp(resolve(dir, strategy.input), {
      caseInsensitive: true,
      extended: true,
    });

    if (pattern.test(fullPath)) {
      await executeStrategy(context, strategy, fullPath);
      break;
    }
  }
}

const HELP_TEXT = `
Declutters folders by moving and compress files in accordance to a sorting manifest

USEAGE:
    sorting-machine [OPTIONS] <PATHS>...

ARGS:
    <PATHS>...
        Paths to files and directories to be sorted. If upsecified, 
        a default path will takend from sorting manifset.

OPTIONS:
    --help
        print this message
    --config
        path to sorting manifest, defaults to ${import.meta.resolve("./config.toml")}
    --dry-run
        prints sorting plan without executing it in stdout

DEFAULT PATHS TEMPLATE ARGS:
    CWD
        Absolute path to Current Working Directory
    HOME
        Absolute path to Home Directory
  
CONVERSION CLI TEMPLATE ARGS:
    CWD
        Absolute path to Current Working Directory
    HOME
        Absolute path to Home Directory
    SOURCE
        Input File Path
    TARGET
        Output File Path

STRATEGY TARGET TEMPLATE ARGS:
    CWD
        Absolute path to Current Working Directory
    HOME
        Absolute path to Home Directory
    DIRECTORY
        Absolute path to directory of source file  (e.g. "/var/www/html")
    BASENAME
        Name of source file without extension (e.g. "index")
    FILENAME
        Name of source file with extension (e.g. "index.html")
    EXTENSION
        Extension of source file (e.g. ".html")
    CREATION_TIME
        Date and Time of source file's creation (e.g. 22-08-15_08-44-87)
    ACCESS_TIME
        Date and Time of source file's last access (e.g. 22-08-15_08-44-87)
    MODIFICATION_TIME
        Date and Time of source file's last modification (e.g. 22-08-15_08-44-87)
`;

async function main() {
  const flags = flagParse(Deno.args, {
    alias: {
      "dry-run": "dryRun",
      config: "overrideConfigPath",
    },
    boolean: ["dry-run", "help"],
    string: ["config"],
  });
  const {
    _: argPaths,
    help,
    overrideConfigPath,
    ...operationFlags
  } = create(flags, Flags);

  if (help) {
    console.log(HELP_TEXT);
    return;
  }

  const configPath =
    overrideConfigPath ?? new URL(import.meta.resolve("./config.toml"));

  const config = create(tomlParse(await Deno.readTextFile(configPath)), Config);

  const model = {
    CWD: Deno.cwd(),
    HOME: Deno.env.get("HOME") ?? ".",
  };

  const context = {
    flags: operationFlags,
    config,
    model,
  };

  const inputPaths =
    argPaths.length !== 0
      ? argPaths
      : context.config.options.defaultPaths.map((template) =>
          render(template, model)
        );

  if (context.flags.dryRun) {
    console.log(`${chalk.bold.magenta("DRY RUN")}: starting`);
  }

  console.log(`${chalk.bold.blue("INPUT PATTERNS")}: ${inputPaths.join(", ")}`);
  for (const inputPath of inputPaths) {
    const resolvedPath = resolve(inputPath);
    const { isDirectory, isFile } = await Deno.stat(resolvedPath);

    if (isDirectory) {
      await sortDirectory(context, inputPath);
    } else if (isFile) {
      await sortFile(context, inputPath);
    }
  }

  if (context.flags.dryRun) {
    console.log(`${chalk.bold.magenta("DRY RUN")}: ending`);
  }
}

main();
