/** Sobe o GLPI SIMULADO numa porta fixa (E2E e desenvolvimento). Nunca use em produção. */
import { startFakeGlpi } from './fakeGlpi';

const port = Number(process.env.FAKE_GLPI_PORT ?? 3398);
startFakeGlpi(port).then((g) => console.log(`GLPI simulado em ${g.url}`));
