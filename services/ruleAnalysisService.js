const { extractUrls, inspect } = require('./urlAnalysisService');
const { LEVELS, classify } = require('./riskClassification');

/** Bounded phrase relationships, not a keyword-count or a fraud probability. */
function analyze(message) {
  const indicators = [];
  const strengths = [];
  // Split opposing instructions so protective advice cannot mask a later request.
  const clauses = message.split(/(?:[.!?]\s+|[;]+|(?<!never)(?<!do not)(?<!don't)\n+(?=\s*(?:share|send|enter|pay|transfer|approve)\b)|,\s*(?=(?:share|send|enter|pay|transfer|approve)\b)|\b(?:but|however|instead)\b|\band\s+(?=(?:share|send|enter|pay|transfer|approve)\b))/i).filter(Boolean);
  const protective = text => /\b(?:never|do not|don't|must not|should not)\s+(?:ever\s+)?(?:share|send|disclose|enter|give|provide|reveal|approve|transfer|pay)\b/i.test(text);
  function add(type, evidence, explanation, strength) {
    if (indicators.some(item => item.type === type)) return;
    indicators.push({ type, evidence, explanation }); strengths.push(strength);
  }
  const disclosure = /\b(?:otp|(?:upi\s+)?pin|password|cvv)\b[^.!?]{0,25}\b(?:required|needed)\b|\b(?:share|send|disclose|enter|give|provide|reveal|tell|submit)\b[^.!?]{0,70}\b(?:otp|one[-\s]?time\s+(?:code|password)|(?:upi\s+)?pin|password|cvv)\b/i;
  const payment = /\b(?:pay|transfer|deposit|send|approve|authorize)\b[^.!?]{0,80}\b(?:rs\.?|inr|usd|money|fee|payment|deposit|collect\s+request|mandate|funds)\b/i;
  const threat = /\b(?:account|upi|card|access|service)\b[^.!?]{0,55}\b(?:blocked|suspended|disabled|deactivated|terminated)\b/i;
  const urgent = /\b(?:immediately|urgent|now|within\s+\d+\s+minutes?|in\s+\d+\s+minutes?)\b/i;
  for (const clause of clauses) {
    if (protective(clause)) continue;
    const hindiAdvice = /(?:कभी|किसी).{0,35}\s(?:न|मत|नहीं)\s.{0,20}(?:साझा|भेज|बता)|(?:साझा|शेयर)\s+(?:न|मत)\s+करें|(?:OTP|ओटीपी|पिन|पासवर्ड).{0,15}\s(?:न|मत)\s+(?:भेज|बता|दर्ज)/iu.test(clause);
    const hindiCredential = !hindiAdvice && clause.match(/(?:OTP|ओटीपी|पिन|पासवर्ड).{0,60}(?:भेजें|बताएं|साझा करें|दर्ज करें|दें)|(?:भेजें|बताएं|साझा करें|दर्ज करें|दें).{0,60}(?:OTP|ओटीपी|पिन|पासवर्ड)/iu);
    const credential = clause.match(disclosure) || hindiCredential;
    if (credential) add(/\botp|one[-\s]?time/i.test(credential[0]) ? 'OTP request' : 'Credential request', credential[0], 'Requests disclosure or entry of authentication information. Do not give a sender your OTP, PIN, password, or CVV.', 'strong');
    const demand = clause.match(payment);
    if (demand) add('Payment request', demand[0], 'Requests a transfer or payment authorization, rather than reporting a completed debit or credit. Verify its purpose and recipient independently.', 'moderate');
    const accountThreat = clause.match(threat);
    if (accountThreat) add('Account threat', accountThreat[0], 'Threatens loss of account access. Confirm any required action through the official app or support channel.', 'moderate');
    const pressure = clause.match(urgent);
    if (pressure && (credential || demand || accountThreat)) add('Urgency', clause.trim(), 'Combines pressure to act quickly with a sensitive request or account-access threat.', 'moderate');
  }
  const actionable = clauses.filter(clause => !protective(clause)).join(' ');
  const job = /\b(?:job|internship|recruitment|hiring|employment|offer\s+letter)\b/i;
  const fee = /\b(?:registration|processing|training|security|advance)\s+(?:fee|deposit|payment)\b/i;
  const feeDemand = payment.test(actionable) || /\b(?:requires?|required|must|mandatory)\b[^.!?]{0,80}\b(?:fee|deposit|payment)\b|\b(?:fee|deposit|payment)\b[^.!?]{0,40}\b(?:required|mandatory)\b/i.test(actionable);
  const benefit = job.test(actionable) || /\b(?:prize|lottery|grant|loan|reward|refund|winnings)\b/i.test(actionable);
  if (benefit && fee.test(actionable) && feeDemand) {
    add('Advance-fee offer', message, 'Combines an employment or financial-benefit offer with a requested upfront fee. Verify the organization and terms independently before paying.', 'strong');
  }
  if (/\b(?:refund|receive|cashback|reward)\b/i.test(actionable) && /\b(?:upi|collect\s+request)\b/i.test(actionable) && /\b(?:enter|share|approve|authorize)\b/i.test(actionable)) {
    add('Refund authorization request', message, 'Asks for a PIN or payment approval in order to receive money. Review any authorization in the official payment app; do not approve an unexpected debit.', 'strong');
  }
  if (payment.test(actionable) && /\b(?:reactivate|restore|unblock|prevent\s+(?:account\s+)?suspension)\b/i.test(actionable)) {
    add('Payment for account access', message, 'Requests money to restore or protect account access. Verify this demand with the institution through an independent channel.', 'strong');
  }
  // Include plain domains common in SMS. Never resolve or visit user links.
  const firstUrl = extractUrls(message)[0];
  const url = firstUrl ? [firstUrl] : null;
  const promotion = /\b(?:sale|shop|retail|store|collection|clothing|fashion|discount|offer)\b/i.test(message) &&
    /(?:\b\d{1,3}\s*%\s*off\b|\bdiscount\b|\bsale\s+(?:on|ends|starts)\b)/i.test(message);
  const offerDeadline = message.match(/\b(?:only\s+(?:have\s+)?\d+\s+(?:days?|hours?)|offer\s+ends?\s+(?:today|tomorrow)|limited[- ]time)\b/i);
  if (url) {
    const shortened = inspect(url[0]).signals.includes('shortened_link');
    add(shortened ? 'Shortened link' : 'Unverified link', url[0], shortened ? 'This shortened link conceals its final destination. Verify the offer through the retailer’s official app or website. Shortening alone is not proof of fraud.' : 'The destination and sender cannot be authenticated from this message. Open the official app or website independently instead of using an unsolicited link.', 'moderate');
    if (promotion && offerDeadline) add('Promotional time pressure', offerDeadline[0], 'A limited-time offer encourages quick action through a link. Such deadlines are common in advertising and do not establish fraud; check the offer independently.', 'moderate');
    if (/\b(?:bank|sbi|pnb|government|kyc)\b/i.test(actionable) && threat.test(actionable)) {
      add('Authority and link pressure', message, 'Combines an institutional or KYC claim, a link, and an account-access threat. This combination is associated with phishing.', 'strong');
    }
  }
  const verification = message.match(/\b(?:fwd|forward|send|reply|call|contact)\b[^.!?]{0,160}\b(?:block|verify|confirm|report|secure)\b[^.!?]{0,40}/i);
  // Official-channel protective advice is context, not a threat. Supplied phone
  // numbers/forwarding instructions remain ambiguous: they are not authenticated.
  const suppliedContact = /\b(?:fwd|forward|reply|send)\b/i.test(verification?.[0] || '') ||
    /\b(?:call|contact)\b[^.!?]{0,50}\d[\d\s+-]{5,}/i.test(message);
  const accountVerification = message.match(/\b(?:account|kyc|identity)\b[^.!?]{0,40}\b(?:needs?\s+verification|verify|update|required|confirm)\b|\b(?:verify|update|confirm)\b[^.!?]{0,40}\b(?:account|kyc|identity)\b/i);
  if ((verification && suppliedContact) || accountVerification) add('Verification instruction', accountVerification?.[0] || verification[0], 'The verification instruction or supplied contact details need independent confirmation. A protective instruction in a transaction alert is not proof of fraud.', 'moderate');

  const transaction = /\b(?:debited|credited|withdrawn|spent|transaction\s+(?:of|for))\b/i.test(message) &&
    /\b(?:a\/c|account|upi|inr|rs|usd|balance|bal)\b/i.test(message) && /\d/.test(message);
  const college = /\b(?:college|university|class|lecture|exam|library|campus)\b/i.test(message) &&
    /\b(?:announcement|tomorrow|schedule|room|begins?|starts?|due|return|bring|reminder)\b/i.test(message);
  const personal = /\b(?:hi|hello|hey|thanks|thank you|see you|meet you)\b/i.test(message) &&
    /\b(?:lunch|dinner|tomorrow|meeting|weekend|help|soon|today)\b/i.test(message);
  const safetyAdvice = clauses.some(clause => protective(clause) && /\b(?:otp|pin|password|cvv)\b/i.test(clause));
  // An unmatched sensitive request must not inherit low concern from a greeting.
  const unresolved = /\b(?:click|download|install|login|log in|verify|send|transfer|payment|pay|otp|pin|password|kyc|crypto|prize|won)\b/i.test(actionable);
  const routine = (transaction || college || personal || safetyAdvice || promotion) && !unresolved;
  const riskLevel = classify({ strong: strengths.includes('strong'), moderate: strengths.includes('moderate'), routine });
  const summary = riskLevel === LEVELS.HIGH ? 'Strong warning signs were found in the requested actions. This is an indicative assessment, not a confirmed fraud finding.'
    : riskLevel === LEVELS.MEDIUM ? transaction
      ? 'This resembles a transaction alert with instructions or contact details requiring independent verification. This is not proof of fraud.'
      : promotion ? 'This resembles a retail promotional message, possibly unsolicited advertising. Its link or deadline warrants verification; this is not proof of fraud.'
      : 'The message contains requests or details that require independent verification.'
    : riskLevel === LEVELS.LOW ? transaction
      ? 'This resembles a routine transaction alert without a detected sensitive-information or payment request. The sender is not authenticated.'
      : promotion ? 'This resembles ordinary retail advertising without a detected sensitive request or unverified link. The offer and sender remain unverified.'
      : 'The message has recognizable routine context without detected meaningful scam indicators. Its sender and claims remain unverified.'
    : 'There is insufficient recognized context for a reliable assessment. No conclusion about safety can be drawn.';
  const recommendedActions = [
    ...(indicators.some(item => ['OTP request', 'Credential request'].includes(item.type)) ? ['Do not share your OTP, PIN, password, or CVV with the sender.'] : []),
    ...(indicators.some(item => /Payment|fee|authorization/.test(item.type)) ? ['Do not pay or approve an unexpected request before independently confirming its purpose and recipient.'] : []),
    ...(transaction ? ['Check the transaction independently in your bank’s official app or statement.'] : []),
    'Verify important requests through an official app, website, or independently obtained contact details.',
    ...(suppliedContact ? ['Verify any forwarding instruction or contact number independently before sending this SMS or sharing information.'] : []),
  ];
  return { riskLevel, summary, indicators, recommendedActions,
    uncertainty: 'This assessment uses limited English rules and selected Hindi credential-request patterns, not Gemma AI. The sender, claims, links, transaction, and contact details have not been independently verified.',
    analysisMode: 'rule-based' };
}
module.exports = { analyze };
