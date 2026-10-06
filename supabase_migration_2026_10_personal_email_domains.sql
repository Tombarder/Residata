-- Personal e-mail providers — the complete list (Boss 2026-10-06: only work e-mails
-- sign up on the web; gmail, yahoo, … only when an admin adds the person, which
-- puts that one address on reference.signup_email_policy.exempt_emails).
--
-- Replaces the 37-domain list. Two parts, the SAME two as the sign-up form
-- (src/lib/emailValidation.js; src/lib/emailValidation.test.mjs fails if they
-- ever differ):
--   · exact domains — free mailboxes, consumer ISP mail (SK, CZ, the big foreign
--     ones), privacy relays, throwaway inboxes;
--   · brands with a mailbox domain in many countries (yahoo.co.uk, hotmail.de,
--     outlook.sk, gmx.at …): the brand followed by nothing but a public ending.
--
-- Same signature and volatility as before, so every caller (signup_email_allowed,
-- enforce_business_email_signup, handle_new_user) keeps working unchanged.
-- Before applying: no existing account outside the exemption list is caught.

create or replace function public.is_personal_email(email text)
returns boolean
language plpgsql
immutable
set search_path to ''
as $fn$
declare
  d text := lower(btrim(split_part(coalesce(email, ''), '@', 2)));
begin
  if d = '' then
    return false;
  end if;
  if d = any (array[
    'me.com', 'mac.com', 'aim.com', 'msn.com', 'passport.com', 'mail.com',
    'email.com', 'usa.com', 'post.com', 'inbox.com', 'lycos.com', 'fastmail.com',
    'fastmail.fm', 'hey.com', 'proton.me', 'pm.me', 'tuta.io', 'tutamail.com',
    'keemail.me', 'zoho.com', 'runbox.com', 'posteo.de', 'posteo.net', 'mailbox.org',
    'disroot.org', 'riseup.net', 'startmail.com', 'countermail.com', 'mail2world.com', 'duck.com',
    'mozmail.com', 'privaterelay.appleid.com', 'simplelogin.com', 'simplelogin.co', 'aleeas.com', 'anonaddy.com',
    'anonaddy.me', '33mail.com', 'azet.sk', 'centrum.sk', 'zoznam.sk', 'atlas.sk',
    'post.sk', 'pobox.sk', 'szm.sk', 'stonline.sk', 'orangemail.sk', 'chello.sk',
    'nextra.sk', 'inmail.sk', 'seznam.cz', 'email.cz', 'post.cz', 'centrum.cz',
    'atlas.cz', 'volny.cz', 'tiscali.cz', 'quick.cz', 'iol.cz', 'mybox.cz',
    'chello.cz', 'upcmail.cz', 'cbox.cz', 'web.de', 't-online.de', 'freenet.de',
    'arcor.de', 'bluewin.ch', 'wp.pl', 'o2.pl', 'onet.pl', 'interia.pl',
    'op.pl', 'libero.it', 'virgilio.it', 'tiscali.it', 'laposte.net', 'orange.fr',
    'free.fr', 'sfr.fr', 'wanadoo.fr', 'telenet.be', 'skynet.be', 'ziggo.nl',
    'kpnmail.nl', 'home.nl', 'planet.nl', 'chello.nl', 'xs4all.nl', 'btinternet.com',
    'sky.com', 'virginmedia.com', 'ntlworld.com', 'talktalk.net', 'comcast.net', 'verizon.net',
    'att.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net', 'earthlink.net',
    'juno.com', 'shaw.ca', 'rogers.com', 'sympatico.ca', 'bigpond.com', 'optusnet.com.au',
    'ya.ru', 'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'rambler.ru',
    'qq.com', '163.com', '126.com', 'sina.com', 'naver.com', 'hanmail.net',
    'daum.net', '10minutemail.com', '10minutemail.net', 'sharklasers.com', 'grr.la', 'guerrillamailblock.com',
    'tempmail.com', 'tempmail.net', 'temp-mail.org', 'temp-mail.io', 'tempmailo.com', 'tempr.email',
    'trashmail.com', 'trashmail.de', 'getnada.com', 'maildrop.cc', 'dispostable.com', 'throwawaymail.com',
    'emailondeck.com', 'mohmal.com', 'fakeinbox.com', 'mintemail.com', 'spamgourmet.com', 'mailnesia.com',
    'discard.email', 'burnermail.io', 'mailcatch.com', 'mytemp.email', 'moakt.com', 'getairmail.com',
    'inboxkitten.com', 'mailpoof.com', 'emailfake.com'
  ]) then
    return true;
  end if;
  return d ~ '^(gmail|googlemail|hotmail|outlook|live|windowslive|yahoo|ymail|rocketmail|aol|icloud|gmx|yandex|protonmail|tutanota|zohomail|hushmail|rediffmail|mailinator|yopmail|guerrillamail)\.((com|net|org|[a-z]{2})|((co|com|net|org)\.[a-z]{2}))$';
end;
$fn$;
