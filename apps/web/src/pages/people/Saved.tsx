/** Publicações salvas pela pessoa (só ela vê a lista). */
import { Feed } from './feed/Feed';

export function SavedPage() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <Feed filter={{ salvos: true }} orderable={false} title="Publicações salvas" emptyTitle="Nada salvo ainda" emptyText="Toque em Salvar numa publicação para encontrá-la aqui depois." />
    </div>
  );
}
