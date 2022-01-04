import {
  batch,
  bufname,
  Denops,
  flags,
  fn,
  helper,
  option,
} from "../../deps.ts";
import * as buffer from "../../util/buffer.ts";
import { toBooleanArgs, toStringArgs } from "../../util/arg.ts";
import { getOrFindWorktree, normCmdArgs } from "../../util/cmd.ts";
import { decodeUtf8 } from "../../util/text.ts";
import { run } from "../../git/process.ts";

export async function command(
  denops: Denops,
  args: string[],
  filemode: boolean,
): Promise<void> {
  const [opts, commitish, path] = parseArgs(
    await normCmdArgs(denops, args),
    filemode,
  );
  const worktree = await getOrFindWorktree(denops, opts);
  const bname = bufname.format({
    scheme: "gindiff",
    expr: worktree,
    params: {
      cached: opts["cached"],
      renames: opts["renames"],
      diffFilter: opts["diffFilter"],
      reverse: opts["reverse"],
      ignoreCrAtEol: opts["ignoreCrAtEol"],
      ignoreSpaceAtEol: opts["ignoreSpaceAtEol"],
      ignoreSpaceChange: opts["ignoreSpaceChange"],
      ignoreAllSpace: opts["ignoreAllSpace"],
      ignoreBlankLines: opts["ignoreBlankLines"],
      ignoreMatchingLines: opts["ignoreMatchingLines"],
      ignoreSubmodules: opts["ignoreSubmodules"],
      commitish,
      "--": opts["--"],
    },
    fragment: path,
  });
  await buffer.open(denops, bname.toString());
}

export async function read(denops: Denops): Promise<void> {
  const [bufnr, bname] = await batch.gather(denops, async (denops) => {
    await fn.bufnr(denops, "%");
    await fn.bufname(denops, "%");
  }) as [number, string];
  const { expr, params, fragment } = bufname.parse(bname);
  const args = [
    "diff",
    "--no-color",
    ...toBooleanArgs("--cached", params?.cached),
    ...toBooleanArgs("--renames", params?.renames, {
      falseFlag: "--no-renames",
    }),
    ...toStringArgs("--diff-filter", params?.diffFilter),
    ...toBooleanArgs("-R", params?.reverse),
    ...toBooleanArgs("--ignore-cr-at-eol", params?.ignoreCrAtEol),
    ...toBooleanArgs("--ignore-space-at-eol", params?.ignoreSpaceAtEol),
    ...toBooleanArgs("--ignore-space-change", params?.ignoreSpaceChange),
    ...toBooleanArgs("--ignore-all-space", params?.ignoreAllSpace),
    ...toBooleanArgs("--ignore-blank-lines", params?.ignoreBlankLines),
    ...toStringArgs("--ignore-matching-lines", params?.ignoreMatchingLines),
    ...toStringArgs("--ignore-submodules", params?.ignoreSubmodules),
    ...(params?.commitish ? [params.commitish as string] : []),
    ...(fragment ? [fragment] : []),
    ...(params?.["--"] ? params["--"] : []),
  ];
  const env = await fn.environ(denops) as Record<string, string>;
  const proc = run(args, {
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    noOptionalLocks: true,
    cwd: expr,
    env,
  });
  const [status, stdout, stderr] = await Promise.all([
    proc.status(),
    proc.output(),
    proc.stderrOutput(),
  ]);
  proc.close();
  if (!status.success) {
    await denops.cmd("echohl Error");
    await helper.echo(denops, decodeUtf8(stderr));
    await denops.cmd("echohl None");
    return;
  }
  const content = decodeUtf8(stdout).split("\n");
  await batch.batch(denops, async (denops) => {
    await option.filetype.setLocal(denops, "diff");
    await option.modifiable.setLocal(denops, false);
  });
  await buffer.replace(denops, bufnr, content);
  await buffer.concrete(denops, bufnr);
}

function parseArgs(
  args: string[],
  filemode: boolean,
): [flags.Args, string | undefined, string | undefined] {
  const opts = flags.parse(args, {
    string: [
      "-worktree",
    ],
    boolean: true,
    alias: {
      R: "reverse",
      b: "ignoreSpaceChange",
      w: "ignoreAllSpace",
      I: "ignoreMatchingLines",
    },
    "--": true,
  });
  if (filemode) {
    // GinDiffFile [{options}] [{commitish}] {path}
    switch (opts._.length) {
      case 1:
        return [opts, undefined, opts._[0].toString()];
      case 2:
        return [opts, opts._[0].toString(), opts._[1].toString()];
      default:
        throw new Error("Invalid number of arguments");
    }
  } else {
    // GinDiff [{options}] [{commitish}]
    switch (opts._.length) {
      case 0:
        return [opts, undefined, undefined];
      case 1:
        return [opts, opts._[0].toString(), ""];
      default:
        throw new Error("Invalid number of arguments");
    }
  }
}