import { defineConfig } from 'vitest/config';
import { BaseSequencer } from 'vitest/node';

/**
 * Os arquivos zz-* (ex.: limpar a base) apagam dados da empresa de teste e precisam rodar por último. A ordem padrão do
 * Vitest põe primeiro o que falhou na execução anterior; aqui o zz-* vai sempre para o fim, mantendo o resto.
 */
class ZzLastSequencer extends BaseSequencer {
  override async sort(files: Parameters<BaseSequencer['sort']>[0]) {
    const sorted = await super.sort(files);
    const path = (f: (typeof sorted)[number]) => (Array.isArray(f) ? String(f[1]) : String((f as { moduleId?: string }).moduleId ?? ''));
    const last = (f: (typeof sorted)[number]) => /[\\/]zz-[^\\/]*$/.test(path(f));
    return [...sorted.filter((f) => !last(f)), ...sorted.filter(last)];
  }
}

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    sequence: { sequencer: ZzLastSequencer },
  },
});
