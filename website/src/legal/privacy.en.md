**Effective date:** 2026-10-28

Trina Inc. (주식회사 트리나, "**we**") provides Trina AX hosting ("**Hosting**") and the website https://ax.trina.app. This policy explains what personal information we collect about our customers, website visitors and people who contact us, why, and what rights you have. Trina Inc. is the controller of this information. The policy is written to meet Korea's Personal Information Protection Act (PIPA) and, for people in the EU/UK, the GDPR.

**This policy does not cover the content inside a customer's Trina AX server.** For the files, database and logs on that server, the customer is the controller and we act only as its processor, under §12 of our Terms of Service (https://ax.trina.app/terms). For transparency, this is how Hosting handles that content:
- Each customer has its own virtual server from Amazon Web Services (AWS), in the AWS Asia Pacific (Seoul) region, Republic of Korea. Its files, database, logs and backups are stored in AWS Seoul.
- The server's address, `https://<company>.trina.app`, passes through Cloudflare, Inc. for DNS, TLS and proxy services. To deliver traffic, Cloudflare decrypts and re-encrypts it at its network edge, which may be outside Korea.
- What Claude reads to answer a question goes to Anthropic under the customer's own agreement with Anthropic (§4).
- We do not use customer content to train AI models, and we do not sell it.
- If you run Trina AX yourself, it runs on your own hardware, and we have no access to it unless you give it to us.

## 1. What we collect and why

| Purpose | Information | Legal basis (GDPR) | Kept for |
|---|---|---|---|
| Responding to inquiries and setup calls | Name, work email, company, role, phone (optional), message content | Steps before a contract / legitimate interest | 1 year after the last contact, unless you become a customer |
| Providing Hosting and Custom Services | Customer contact names, work emails, company details, server details needed for operation, support emails, operator access logs | Contract | For the term of the contract + 1 year (operator access logs: 3 years) |
| Billing and taxes | Company name, billing contact, billing address, country, tax ID, order and invoice records. Card and payment details are collected by our reseller, not by us | Contract / legal obligation | 5 years as required by Korean tax law (국세기본법) |
| Service emails (setup, security, billing and changes to the Service) | Work email | Contract / legitimate interest | Until the contract ends |
| Website security and basic analytics | IP address, browser type, pages visited, timestamps (request logs); visit statistics from Cloudflare Web Analytics, which does not use cookies | Legitimate interest | Up to 90 days |

We do not collect resident registration numbers or sensitive information, and we do not sell personal information.

## 2. Cookies and local storage

The website https://ax.trina.app is hosted on Cloudflare (Workers) and uses Cloudflare Web Analytics, which is cookieless. The website sets no cookies of its own other than strictly necessary ones. It stores only your light/dark theme choice, in your browser's local storage; this stays in your browser. We do not use advertising cookies. The checkout window is run by our reseller under its own policy and may set its own cookies.

## 3. Sharing with third parties

We share personal information only:
- (a) with the processors listed in §5, so they can perform services for us;
- (b) with our online reseller and Merchant of Record: **Polar Software, Inc.** (USA) or **Creem**, operated by **Armitage Labs OÜ** (Estonia), as shown at checkout. When you buy through our online checkout, the reseller collects your payment and billing details and processes them as an independent controller under its own privacy policy. It shares with us the order details we need: name, email, company, country, tax ID and items purchased;
- (c) when required by law or a valid order from a public authority;
- (d) to protect the rights, property or safety of our customers or others.

## 4. Claude and Anthropic

Anthropic is not our processor. Customers use Claude with their own Claude plans or their own Anthropic API key. The content Claude reads to answer goes from the customer's server to Anthropic under the customer's own agreement with Anthropic. We are not a party to that transfer, and Anthropic's handling of that content is governed by Anthropic's terms and privacy policy.

## 5. Processors and international transfers

We use the following service providers. Some are outside Korea or work over a global network, so some information is transferred abroad. These transfers are needed to provide the Service and the website. You may refuse a transfer by not using the service concerned or by contacting us at contact@trina.app; for some items (such as checkout or the Cloudflare proxy), refusing means we cannot provide the Service.

| Recipient | Country | What | Why | How / when | Kept for |
|---|---|---|---|---|---|
| Amazon Web Services, Inc. | Republic of Korea (AWS Asia Pacific (Seoul) region). Hosted customer content is not transferred abroad | Each customer's server: files, database, logs and backups | Running customer servers (Hosting) | Over the network, continuously while the customer uses Hosting | Contract term, then deleted as in §6 |
| Cloudflare, Inc. | United States; traffic passes through its global network | Traffic to `<company>.trina.app`, including IP addresses and request content, which Cloudflare decrypts and re-encrypts at its network edge; website request logs and cookieless analytics | DNS, TLS and proxy for customer server addresses; hosting and analytics for ax.trina.app | Over the network, on each request | Traffic: processed in transit; website logs: up to 90 days |
| Polar Software, Inc. or Armitage Labs OÜ (Creem), as shown at checkout. Independent controllers for payment data | United States / Estonia | Name, email, company, billing address, country, tax ID, payment details | Online checkout, tax and invoicing | Over the network when you check out and at each renewal | Per the reseller's own policy |
| Kakao Corp. | Republic of Korea | Emails you send us; recipient addresses and content of service emails we send | Business email (Daum mail) | Over the network when an email is sent or received | Per our retention in §1 |

We use the National Tax Service's Hometax system only to issue electronic tax invoices to customers contracted directly by quote.

Contact details of overseas recipients are available on request at contact@trina.app.

## 6. How long we keep information and how we delete it

We keep information for the periods in §1. When a Hosting subscription ends, the customer's server is stopped and its data is kept for 30 days so the customer can ask for an export. After that, the server and its data are deleted, and backups are deleted within a further 30 days.

When the retention period ends or the purpose is achieved, we delete electronic records so they cannot be recovered and shred paper records. Records we must keep by law (such as tax records) are stored separately and kept only for the required period.

## 7. Your rights

You can ask us to access, correct, delete or stop processing your personal information, to withdraw consent, and (in the EU/UK) to port your data or object to processing. Email contact@trina.app; we will respond within 10 days (PIPA) or one month (GDPR). You may also have a representative make the request. We may need to verify your identity. If a child under 14 is involved, a legal guardian may exercise these rights, though our services are not directed at children.

If your request is about content inside a company's Trina AX server (for example, as an employee of one of our customers), please contact that company, which is the controller. We will help it respond.

## 8. Security measures

We apply administrative, technical and physical safeguards, including: a separate server for each customer; access to customer servers limited to named staff with individual accounts and multi-factor authentication; logging of operator access; encryption in transit; least-privilege access to billing records; staff confidentiality commitments; and an internal personal-information management plan.

## 9. Privacy officer

| | |
|---|---|
| Controller | Trina Inc. (주식회사 트리나), 27-8 Obong-ro, Sannae-myeon, Gyeongju-si, Gyeongsangbuk-do, Republic of Korea |
| Privacy officer (개인정보 보호책임자) | Daehyeon Nam (남대현), CEO |
| Contact | contact@trina.app · +82 70-8064-3349 |

## 10. Complaints

If you have a concern you can contact us first. You may also contact: Personal Information Dispute Mediation Committee (www.kopico.go.kr, 1833-6972); KISA Personal Information Infringement Report Center (privacy.kisa.or.kr, 118); Supreme Prosecutors' Office (www.spo.go.kr, 1301); Korean National Police Agency Cyber Bureau (ecrm.police.go.kr, 182). EU/UK residents may complain to their local data protection authority.

## 11. Changes

We will post changes on this page with a new effective date, and notify customers by email at least 7 days before material changes (30 days if the change is unfavorable to you).

<!-- draft — lawyer review pending -->
