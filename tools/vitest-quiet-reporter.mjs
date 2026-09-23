/**
 * 静默 reporter（2026-09-23）：
 * 跑测试只为回答两个问题——「过了没有」「没过的话错在哪」。
 * vitest 内置 reporter 在非 TTY（重定向/CI/agent 落盘）会逐文件刷一行（63 文件 ≈ 70+ 行），
 * TTY 下 default 更是一行一个用例；跑一次就把终端/日志文件淹掉。
 * 这里只做两件事：全绿打一行汇总；有失败打失败详情 + 汇总，其余全吞。
 * 健壮性优先——reporter 自身抛错会污染测试结果，所以整体套 try/catch 且不依赖未导出 API。
 */

const PASS = '\u2713';
const FAIL = '\u2717';

function walkTasks(tasks, acc) {
  for (const t of tasks ?? []) {
    if (t?.type === 'test') {
      acc.total += 1;
      if (t.result?.state === 'fail') acc.failedTests.push(t);
      else if (t.result?.state === 'pass') acc.passed += 1;
      else acc.skipped += 1;
    } else if (t?.type === 'suite') {
      walkTasks(t.tasks, acc);
    }
  }
}

function nameOf(t) {
  const parts = [];
  for (let cur = t; cur && cur.type !== 'file'; cur = cur.parent ?? cur.suite) {
    if (cur.name) parts.unshift(cur.name);
  }
  const file = (t?.filepath ?? t?.file?.filepath ?? '').replace(/\\/g, '/');
  const rel = file.includes('/tests/') ? file.split('/tests/').pop() : file;
  return `${rel ? `tests/${rel}` : ''}${parts.length ? ` > ${parts.join(' > ')}` : ''}`;
}

export default class QuietReporter {
  onInit(ctx) {
    this.ctx = ctx;
  }

  onFinished(files = [], errors = []) {
    const log = (...a) => {
      try {
        this.ctx?.logger?.log(...a);
      } catch {
        console.log(...a);
      }
    };
    try {
      const acc = { total: 0, passed: 0, skipped: 0, failedFiles: 0, failedTests: [] };
      for (const f of files ?? []) {
        if (f?.result?.state === 'fail') acc.failedFiles += 1;
        walkTasks(f?.tasks ?? f, acc);
      }

      if (acc.failedTests.length || errors.length) {
        log('');
        log(`${FAIL} 失败 ${acc.failedTests.length} 个用例 / ${acc.failedFiles} 个文件`);
        for (const t of acc.failedTests) {
          log('');
          log(`  ${FAIL} ${nameOf(t)}`);
          for (const e of t.result?.errors ?? []) {
            log(`      ${(e?.message ?? String(e)).split('\n')[0]}`);
            const stack = (e?.stack ?? '').split('\n').slice(1, 6).join('\n');
            if (stack) log(stack.replace(/^/gm, '      '));
          }
        }
        for (const e of errors) {
          log('');
          log(`  ${FAIL} 未捕获错误：${e?.message ?? String(e)}`);
        }
      }

      log('');
      log(
        `  ${PASS} tests ${acc.passed}/${acc.total}` +
          (acc.skipped ? ` (${acc.skipped} skipped)` : '') +
          (acc.failedTests.length ? ` · ${FAIL} failed ${acc.failedTests.length}` : ''),
      );
      if (!acc.failedTests.length && !errors.length) log('  (详细输出：npm run test:verbose)');
    } catch (e) {
      console.log(`[quiet-reporter] 自身异常：${e?.message ?? e}`);
    }
  }
}
