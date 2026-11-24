/**
 * E-mail de acesso (cadastro e nova senha) no padrão visual do RevOps: faixa grafite→azul com a marca BKT | RevOps,
 * cantos retos, azul #2F5986. HTML de e-mail (tabelas e estilos em linha), sem depender de fontes ou imagens externas
 * para ser lido: a logo tem texto alternativo e o restante é texto.
 */
const C = { ink: '#2D3339', text: '#3A424A', muted: '#5F6B76', line: '#E1E5EA', bg: '#F2F4F6', primary: '#2F5986', soft: '#E8EEF5', navy2: '#23282D', light: '#4FBBFF' };
const FONT = "'Work Sans', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const DISPLAY = "Orbitron, 'Work Sans', 'Segoe UI', Helvetica, Arial, sans-serif";

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export type AccessEmail = {
  kind: 'convite_usuario' | 'nova_senha';
  name: string; email: string; password: string;
  loginUrl: string; wikiUrl: string; logoUrl: string; company: string;
  /** assinatura de quem cadastrou (imagem embutida por cid ou texto), já em HTML */
  signatureHtml?: string;
};

const button = (href: string, label: string, primary = true) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
    <td bgcolor="${primary ? C.primary : '#FFFFFF'}" style="background:${primary ? C.primary : '#FFFFFF'};border:1px solid ${C.primary}">
      <a href="${esc(href)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;color:${primary ? '#FFFFFF' : C.primary};text-decoration:none">${esc(label)}</a>
    </td></tr></table>`;

const row = (label: string, value: string, mono = false) => `
  <tr>
    <td class="lbl" style="padding:12px 16px;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:13px;color:${C.muted};width:150px;vertical-align:top">${esc(label)}</td>
    <td class="val" style="padding:12px 16px;border-bottom:1px solid ${C.line};font-family:${mono ? "Consolas, 'Courier New', monospace" : FONT};font-size:${mono ? '17px' : '15px'};font-weight:600;color:${C.ink};letter-spacing:${mono ? '1px' : '0'};word-break:break-all">${value}</td>
  </tr>`;

export function accessEmailHtml(m: AccessEmail) {
  const first = m.name.trim().split(/\s+/)[0] ?? m.name;
  const invite = m.kind === 'convite_usuario';
  const title = invite ? 'Seu acesso ao RevOps está pronto' : 'Sua nova senha temporária';
  const intro = invite
    ? `Você foi cadastrado no RevOps${m.company ? ` da ${esc(m.company)}` : ''}, a central de gestão comercial: funil, propostas, contratos, pós-venda, marketing e gestão do time num lugar só.`
    : 'Geramos uma nova senha temporária para o seu acesso ao RevOps. A senha anterior deixou de valer.';
  const preheader = invite ? 'Seu usuário, a senha temporária e o link para entrar.' : 'Use a senha temporária e troque no primeiro acesso.';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700&family=Work+Sans:wght@400;600&display=swap');
  @media (max-width: 620px) { .wrap { width: 100% !important; } .pad { padding-left: 20px !important; padding-right: 20px !important; } .lbl { display:block !important; width:auto !important; border-bottom:0 !important; padding-bottom:0 !important; } .val { display:block !important; padding-top:2px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg}">
<tr><td align="center" style="padding:32px 12px">
  <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;border-collapse:collapse;background:#FFFFFF">
    <!-- faixa da marca: degradê grafite → azul, só no fundo -->
    <tr><td class="pad" bgcolor="${C.navy2}" style="background:${C.navy2};background-image:linear-gradient(90deg, ${C.navy2} 0%, ${C.ink} 45%, ${C.primary} 100%);padding:28px 36px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle"><img src="${esc(m.logoUrl)}" width="104" height="36" alt="BKT" style="display:block;border:0;width:104px;height:36px;font-family:${DISPLAY};font-size:24px;font-weight:700;color:#FFFFFF"></td>
        <td style="vertical-align:middle;padding-left:14px"><span style="display:inline-block;border-left:1px solid rgba(255,255,255,.35);padding-left:14px;font-family:${DISPLAY};font-size:14px;font-weight:700;color:rgba(255,255,255,.85);letter-spacing:.5px">RevOps</span></td>
      </tr></table>
      <h1 style="margin:22px 0 0;font-family:${DISPLAY};font-size:22px;line-height:1.3;font-weight:700;color:#FFFFFF;letter-spacing:.5px">${esc(title)}</h1>
    </td></tr>
    <tr><td style="height:4px;line-height:4px;font-size:0;background:${C.light}">&nbsp;</td></tr>

    <tr><td class="pad" style="padding:32px 36px 8px;font-family:${FONT};color:${C.text};font-size:15px;line-height:1.6">
      <p style="margin:0 0 14px;font-size:17px;font-weight:600;color:${C.ink}">Olá, ${esc(first)}!</p>
      <p style="margin:0 0 24px">${intro}</p>
    </td></tr>

    <tr><td class="pad" style="padding:0 36px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid ${C.line};border-left:4px solid ${C.primary};background:${C.soft}">
        ${row('Link de acesso', `<a href="${esc(m.loginUrl)}" target="_blank" style="color:${C.primary};text-decoration:underline">${esc(m.loginUrl.replace(/^https?:\/\//, ''))}</a>`)}
        ${row('Usuário', esc(m.email))}
        <tr>
          <td class="lbl" style="padding:12px 16px;font-family:${FONT};font-size:13px;color:${C.muted};width:150px;vertical-align:top">Senha temporária</td>
          <td class="val" style="padding:12px 16px;font-family:Consolas, 'Courier New', monospace;font-size:17px;font-weight:600;color:${C.ink};letter-spacing:1px;word-break:break-all">${esc(m.password)}</td>
        </tr>
      </table>
    </td></tr>

    <tr><td class="pad" style="padding:24px 36px 8px">${button(m.loginUrl, 'Acessar o RevOps')}</td></tr>

    <tr><td class="pad" style="padding:16px 36px 0;font-family:${FONT};color:${C.text};font-size:14px;line-height:1.6">
      <p style="margin:0 0 6px;font-weight:600;color:${C.ink}">No primeiro acesso</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
        <tr><td style="padding:3px 10px 3px 0;vertical-align:top;color:${C.primary};font-weight:600">1.</td><td style="padding:3px 0">Entre com o usuário e a senha temporária acima${invite ? ' (ou use <strong>Entrar com Google</strong>, se o seu e-mail for uma conta Google)' : ''}.</td></tr>
        <tr><td style="padding:3px 10px 3px 0;vertical-align:top;color:${C.primary};font-weight:600">2.</td><td style="padding:3px 0">Troque a senha em <strong>Meu perfil</strong>. A senha temporária é só para este primeiro acesso.</td></tr>
        <tr><td style="padding:3px 10px 3px 0;vertical-align:top;color:${C.primary};font-weight:600">3.</td><td style="padding:3px 0">Se quiser, faça o <strong>Tour RevOps</strong>, no menu lateral, para conhecer as telas.</td></tr>
      </table>
    </td></tr>

    <tr><td class="pad" style="padding:28px 36px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid ${C.line}">
        <tr><td style="padding:18px 20px;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.text}">
          <p style="margin:0 0 4px;font-family:${DISPLAY};font-size:14px;font-weight:700;color:${C.ink};letter-spacing:.3px">Wiki RevOps</p>
          <p style="margin:0 0 14px">Na Central de Playbooks estão o manual do sistema, os playbooks e os processos da área, com o passo a passo de cada tela. Comece por lá sempre que tiver dúvida.</p>
          ${button(m.wikiUrl, 'Abrir a wiki', false)}
        </td></tr>
      </table>
    </td></tr>

    ${m.signatureHtml ? `<tr><td class="pad" style="padding:28px 36px 0;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.text}">
      <p style="margin:0 0 14px">Qualquer dúvida, é só responder este e-mail.</p>
      ${m.signatureHtml}
    </td></tr>` : ''}
    <tr><td class="pad" style="padding:24px 36px 32px;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted}">
      <p style="margin:0 0 6px">Por segurança, não compartilhe a sua senha. Se você não esperava este e-mail, avise o administrador do RevOps.</p>
      <p style="margin:0">Se o botão não abrir, copie e cole no navegador: <span style="color:${C.primary}">${esc(m.loginUrl)}</span></p>
    </td></tr>
    <tr><td bgcolor="${C.ink}" style="background:${C.ink};padding:14px 36px;font-family:${FONT};font-size:12px;color:rgba(255,255,255,.75)">BKT | RevOps${m.company ? ` · ${esc(m.company)}` : ''}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}
