# Legal documents live in the private repository

This repository is **public**. The company's internal legal documents — the
Art. 30 record of processing activities, the legitimate-interest assessment for
business outreach, and our data-processing-agreement position — are kept in the
private operations repository instead:

    novostavby-scraper/docs/legal/

They were briefly committed here on 2026-09-03 before that was noticed. Nothing
in them is a credential or an exploitable detail — they describe processors
already named in the public privacy policy, and security measures visible from
the site's own response headers — so the history was not rewritten. But an
internal processing register is not a public document, and the next copy should
not go here.

**What DOES belong in this repo:** anything the website itself serves — the
Privacy Policy, the Terms and the Imprint, which live in `src/pages/LegalPages.jsx`
and read the company's identity from `src/lib/company.js`.
