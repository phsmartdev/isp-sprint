/** Tailwind só aponta para os tokens de src/styles/tokens.css. */
const c = (v) => `rgb(var(--${v}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // breakpoints do workspace (spec §3): 1 coluna ≤899, 2 painéis 900–1279, 3 painéis ≥1280
      screens: { ws2: '900px', ws3: '1280px' },
      colors: {
        bg: c('bg'),
        surface: c('surface'),
        'surface-2': c('surface-2'),
        line: c('line'),
        'line-strong': c('line-strong'),
        ink: c('ink'),
        text: c('text'),
        muted: c('muted'),
        faint: c('faint'),
        navy: { DEFAULT: c('navy'), 2: c('navy-2'), active: c('navy-active') },
        lime: { DEFAULT: c('lime'), ink: c('lime-ink') },
        primary: { DEFAULT: c('primary'), hover: c('primary-hover'), soft: c('primary-soft') },
        success: { DEFAULT: c('success'), soft: c('success-soft') },
        warning: { DEFAULT: c('warning'), soft: c('warning-soft') },
        danger: { DEFAULT: c('danger'), soft: c('danger-soft') },
        purple: { DEFAULT: c('purple'), soft: c('purple-soft') },
        sky: { DEFAULT: c('sky'), soft: c('sky-soft') },
        yellow: c('yellow'),
        focus: c('focus'),
      },
      // raios por marca (tokens.css): BKT tudo reto; Yepnet arredondado. rounded-circle é sempre redondo (fotos, indicadores).
      borderRadius: { none: '0', sm: 'var(--radius-sm)', DEFAULT: 'var(--radius-md)', md: 'var(--radius-md)', lg: 'var(--radius-lg)', xl: 'var(--radius-xl)', '2xl': 'var(--radius-2xl)', '3xl': 'var(--radius-3xl)', full: 'var(--radius-full)', circle: '9999px' },
      boxShadow: { card: 'var(--shadow-card)', overlay: 'var(--shadow-overlay)' },
      // fontes por marca (tokens.css): BKT Work Sans + Orbitron nos títulos; Yepnet Plus Jakarta Sans em tudo
      fontFamily: { sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'], display: ['var(--font-display)', 'system-ui', 'sans-serif'] },
      fontSize: {
        '2xs': ['0.6875rem', '1rem'],
        xs: ['0.75rem', '1.05rem'],
        sm: ['0.8125rem', '1.25rem'],
        base: ['0.875rem', '1.375rem'],
        md: ['1rem', '1.5rem'],
        lg: ['1.125rem', '1.5rem'],
        xl: ['1.5rem', '1.9rem'],
        '2xl': ['2.25rem', '2.6rem'],
      },
    },
  },
  plugins: [],
};
