/** Sobe o Google SIMULADO numa porta fixa (E2E e desenvolvimento). Nunca use em produção. */
import { startFakeGoogle } from './fakeGoogle';

const port = Number(process.env.FAKE_GOOGLE_PORT ?? 3399);
startFakeGoogle(port).then((g) => console.log(`Google simulado em ${g.url}`));
