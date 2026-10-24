/** SMTP: TLS conforme a porta (evita "wrong version number") e erros em português. */
import { describe, expect, it } from 'vitest';
import { smtpErrorText, smtpTls } from '../src/services/email';

describe('SMTP', () => {
  it('465 usa TLS direto; 587 usa STARTTLS mesmo com "SSL" marcado; 25 sobe TLS se marcado', () => {
    expect(smtpTls(465, false)).toEqual({ secure: true, requireTLS: false });
    expect(smtpTls(587, true)).toEqual({ secure: false, requireTLS: true });
    expect(smtpTls(587, false)).toEqual({ secure: false, requireTLS: true });
    expect(smtpTls(25, false)).toEqual({ secure: false, requireTLS: false });
    expect(smtpTls(2465, true)).toEqual({ secure: true, requireTLS: false });
  });
  it('traduz o erro de versão do TLS e o de login', () => {
    expect(smtpErrorText('00A9723D017F0000:error:0A00010B:SSL routines:tls_validate_record_header:wrong version number:ssl/record/methods/tlsany_meth.c:78:')).toMatch(/porta 465 com SSL\/TLS ou a porta 587 com STARTTLS/);
    expect(smtpErrorText('Invalid login: 535-5.7.8 Username and Password not accepted')).toMatch(/senha de app/);
  });
});
