import prisma from "../lib/prisma.js";

// Map US State codes to standard IANA timezone identifiers
const STATE_TIMEZONE_MAP = {
  // Pacific
  CA: "America/Los_Angeles",
  NV: "America/Los_Angeles",
  OR: "America/Los_Angeles",
  WA: "America/Los_Angeles",
  CALIFORNIA: "America/Los_Angeles",
  NEVADA: "America/Los_Angeles",
  OREGON: "America/Los_Angeles",
  WASHINGTON: "America/Los_Angeles",

  // Mountain
  CO: "America/Denver",
  ID: "America/Denver",
  MT: "America/Denver",
  UT: "America/Denver",
  WY: "America/Denver",
  NM: "America/Denver",
  COLORADO: "America/Denver",
  IDAHO: "America/Denver",
  MONTANA: "America/Denver",
  UTAH: "America/Denver",
  WYOMING: "America/Denver",
  "NEW MEXICO": "America/Denver",

  // Arizona (no DST)
  AZ: "America/Phoenix",
  ARIZONA: "America/Phoenix",

  // Central
  AL: "America/Chicago",
  AR: "America/Chicago",
  IL: "America/Chicago",
  IA: "America/Chicago",
  KS: "America/Chicago",
  LA: "America/Chicago",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  NE: "America/Chicago",
  ND: "America/Chicago",
  OK: "America/Chicago",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  WI: "America/Chicago",
  ALABAMA: "America/Chicago",
  ARKANSAS: "America/Chicago",
  ILLINOIS: "America/Chicago",
  IOWA: "America/Chicago",
  KANSAS: "America/Chicago",
  LOUISIANA: "America/Chicago",
  MINNESOTA: "America/Chicago",
  MISSISSIPPI: "America/Chicago",
  MISSOURI: "America/Chicago",
  NEBRASKA: "America/Chicago",
  "NORTH DAKOTA": "America/Chicago",
  OKLAHOMA: "America/Chicago",
  "SOUTH DAKOTA": "America/Chicago",
  TENNESSEE: "America/Chicago",
  TEXAS: "America/Chicago",
  WISCONSIN: "America/Chicago",

  // Eastern
  CT: "America/New_York",
  DE: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  IN: "America/New_York",
  KY: "America/New_York",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  MI: "America/New_York",
  NH: "America/New_York",
  NJ: "America/New_York",
  NY: "America/New_York",
  NC: "America/New_York",
  OH: "America/New_York",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  VT: "America/New_York",
  VA: "America/New_York",
  WV: "America/New_York",
  CONNECTICUT: "America/New_York",
  DELAWARE: "America/New_York",
  FLORIDA: "America/New_York",
  GEORGIA: "America/New_York",
  INDIANA: "America/New_York",
  KENTUCKY: "America/New_York",
  MAINE: "America/New_York",
  MARYLAND: "America/New_York",
  MASSACHUSETTS: "America/New_York",
  MICHIGAN: "America/New_York",
  "NEW HAMPSHIRE": "America/New_York",
  "NEW JERSEY": "America/New_York",
  "NEW YORK": "America/New_York",
  "NORTH CAROLINA": "America/New_York",
  OHIO: "America/New_York",
  PENNSYLVANIA: "America/New_York",
  "RHODE ISLAND": "America/New_York",
  "SOUTH CAROLINA": "America/New_York",
  VERMONT: "America/New_York",
  VIRGINIA: "America/New_York",
  "WEST VIRGINIA": "America/New_York",

  // Alaska
  AK: "America/Anchorage",
  ALASKA: "America/Anchorage",
  // Hawaii
  HI: "Pacific/Honolulu",
  HAWAII: "Pacific/Honolulu",
};

// Select US area codes mapped to timezones
const AREA_CODE_TZ_MAP = {
  // Pacific
  "206": "America/Los_Angeles",
  "253": "America/Los_Angeles",
  "360": "America/Los_Angeles",
  "425": "America/Los_Angeles",
  "509": "America/Los_Angeles",
  "503": "America/Los_Angeles",
  "971": "America/Los_Angeles",
  "209": "America/Los_Angeles",
  "213": "America/Los_Angeles",
  "310": "America/Los_Angeles",
  "323": "America/Los_Angeles",
  "408": "America/Los_Angeles",
  "415": "America/Los_Angeles",
  "510": "America/Los_Angeles",
  "530": "America/Los_Angeles",
  "559": "America/Los_Angeles",
  "562": "America/Los_Angeles",
  "619": "America/Los_Angeles",
  "626": "America/Los_Angeles",
  "650": "America/Los_Angeles",
  "661": "America/Los_Angeles",
  "707": "America/Los_Angeles",
  "714": "America/Los_Angeles",
  "760": "America/Los_Angeles",
  "805": "America/Los_Angeles",
  "818": "America/Los_Angeles",
  "831": "America/Los_Angeles",
  "858": "America/Los_Angeles",
  "909": "America/Los_Angeles",
  "916": "America/Los_Angeles",
  "925": "America/Los_Angeles",
  "949": "America/Los_Angeles",
  "951": "America/Los_Angeles",
  "702": "America/Los_Angeles",
  "775": "America/Los_Angeles",

  // Mountain
  "208": "America/Denver",
  "307": "America/Denver",
  "406": "America/Denver",
  "435": "America/Denver",
  "801": "America/Denver",
  "385": "America/Denver",
  "970": "America/Denver",
  "303": "America/Denver",
  "720": "America/Denver",
  "505": "America/Denver",
  "575": "America/Denver",

  // Arizona
  "480": "America/Phoenix",
  "520": "America/Phoenix",
  "602": "America/Phoenix",
  "623": "America/Phoenix",
  "928": "America/Phoenix",

  // Central
  "205": "America/Chicago",
  "256": "America/Chicago",
  "334": "America/Chicago",
  "479": "America/Chicago",
  "501": "America/Chicago",
  "312": "America/Chicago",
  "773": "America/Chicago",
  "847": "America/Chicago",
  "630": "America/Chicago",
  "815": "America/Chicago",
  "309": "America/Chicago",
  "217": "America/Chicago",
  "618": "America/Chicago",
  "319": "America/Chicago",
  "515": "America/Chicago",
  "316": "America/Chicago",
  "785": "America/Chicago",
  "504": "America/Chicago",
  "225": "America/Chicago",
  "318": "America/Chicago",
  "612": "America/Chicago",
  "651": "America/Chicago",
  "952": "America/Chicago",
  "763": "America/Chicago",
  "218": "America/Chicago",
  "601": "America/Chicago",
  "662": "America/Chicago",
  "314": "America/Chicago",
  "816": "America/Chicago",
  "417": "America/Chicago",
  "402": "America/Chicago",
  "308": "America/Chicago",
  "701": "America/Chicago",
  "405": "America/Chicago",
  "918": "America/Chicago",
  "605": "America/Chicago",
  "901": "America/Chicago",
  "615": "America/Chicago",
  "865": "America/Chicago",
  "423": "America/Chicago",
  "512": "America/Chicago",
  "214": "America/Chicago",
  "972": "America/Chicago",
  "469": "America/Chicago",
  "713": "America/Chicago",
  "281": "America/Chicago",
  "832": "America/Chicago",
  "210": "America/Chicago",
  "817": "America/Chicago",
  "915": "America/Chicago",
  "806": "America/Chicago",
  "956": "America/Chicago",
  "262": "America/Chicago",
  "414": "America/Chicago",
  "608": "America/Chicago",
  "920": "America/Chicago",
  "715": "America/Chicago",

  // Alaska
  "907": "America/Anchorage",
  // Hawaii
  "808": "Pacific/Honolulu",
};

export class ComplianceService {
  /**
   * Estimate the timezone of a lead based on state abbreviation or phone area code
   */
  static getLeadTimezone(state, phone) {
    if (state) {
      const cleanState = state.trim().toUpperCase();
      if (STATE_TIMEZONE_MAP[cleanState]) {
        return STATE_TIMEZONE_MAP[cleanState];
      }
    }

    if (phone) {
      const digits = phone.replace(/\D/g, "");
      // For E.164: +12345678901 -> country code 1, area code is 234 (digits indices 1, 2, 3 if length is 11)
      let areaCode = "";
      if (digits.length === 11 && digits.startsWith("1")) {
        areaCode = digits.substring(1, 4);
      } else if (digits.length === 10) {
        areaCode = digits.substring(0, 3);
      }

      if (areaCode && AREA_CODE_TZ_MAP[areaCode]) {
        return AREA_CODE_TZ_MAP[areaCode];
      }
    }

    return "America/New_York"; // Default to Eastern Time
  }

  /**
   * Check if the current time in the given timezone is within allowed TCPA sending hours (8:00 AM - 9:00 PM)
   */
  static checkSendingHours(timeZone) {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        hour12: false,
      });
      const hour = parseInt(formatter.format(new Date()), 10);
      return hour >= 8 && hour < 21; // 8 AM to 9 PM (exclusive of 9:00 PM)
    } catch (error) {
      console.error(
        `[Compliance Service] Timezone check failed for ${timeZone}:`,
        error
      );
      return true; // Default to sending if check fails to prevent infinite queue lockups
    }
  }

  /**
   * Validate if an outbound message is allowed to be sent to a lead
   */
  static async validateOutboundMessage(leadId, channel) {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { company: true },
    });

    if (!lead) {
      return { allowed: false, reason: "Lead not found" };
    }

    const { company } = lead;
    const value = channel === "EMAIL" ? lead.email : lead.phone;

    if (!value) {
      return {
        allowed: false,
        reason: `Lead lacks contact details for channel ${channel}`,
      };
    }

    const normalizedValue =
      channel === "EMAIL"
        ? value.trim().toLowerCase()
        : value.replace(/\D/g, "");

    // 1. Check suppression list
    const suppressed = await prisma.suppressionList.findFirst({
      where: {
        companyId: lead.companyId,
        value: {
          equals: normalizedValue,
          mode: "insensitive",
        },
      },
    });

    if (suppressed) {
      return {
        allowed: false,
        reason: `Contact is on the suppression list (Reason: ${suppressed.reason})`,
      };
    }

    // 2. Check consent flags
    if (company.complianceOptInRequired) {
      if (channel === "SMS" && !lead.smsOptIn) {
        return {
          allowed: false,
          reason: "Explicit SMS consent is required and not granted",
        };
      }
      if (channel === "EMAIL" && lead.emailOptIn === false) {
        // For email, block if they explicitly opted out (optIn is false)
        return {
          allowed: false,
          reason: "Explicit email consent was revoked (Opt-out)",
        };
      }
    } else {
      // If compliance checks are relaxed, still block if they are explicitly marked as opt-out (optIn === false)
      if (channel === "SMS" && lead.smsOptIn === false) {
        return { allowed: false, reason: "SMS communications are opted out" };
      }
      if (channel === "EMAIL" && lead.emailOptIn === false) {
        return { allowed: false, reason: "Email communications are opted out" };
      }
    }

    // 3. Check quiet hours (SMS only)
    if (channel === "SMS") {
      const tz = this.getLeadTimezone(lead.state, lead.phone);
      const isWithinHours = this.checkSendingHours(tz);
      if (!isWithinHours) {
        return {
          allowed: false,
          reason: `Quiet Hours active in recipient timezone (${tz}). Re-try between 8 AM and 9 PM.`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Process incoming SMS keyword triggers (STOP, HELP, START)
   */
  static async handleInboundKeyword(companyId, senderContact, messageText, channel) {
    const text = messageText.trim().toUpperCase();
    const isSms = channel === "SMS";

    const stopKeywords = ["STOP", "UNSUBSCRIBE", "QUIT", "CANCEL", "END"];
    const startKeywords = ["START", "YES", "UNSTOP", "RESUBSCRIBE"];
    const helpKeywords = ["HELP", "INFO"];

    const normalizedContact = isSms
      ? senderContact.replace(/\D/g, "")
      : senderContact.trim().toLowerCase();

    // Find the lead(s) for this company matching the contact info
    const leads = await prisma.lead.findMany({
      where: {
        companyId,
        OR: [
          { email: normalizedContact },
          { phone: { contains: normalizedContact.slice(-10) } }, // match last 10 digits
        ],
      },
    });

    if (leads.length === 0) {
      return { isComplianceAction: false };
    }

    if (stopKeywords.includes(text)) {
      // 1. Opt-out
      for (const lead of leads) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            smsOptIn: isSms ? false : lead.smsOptIn,
            emailOptIn: !isSms ? false : lead.emailOptIn,
            consentSource: isSms
              ? "SMS STOP Keyword"
              : "Email Unsubscribe Request",
            consentTimestamp: new Date(),
            timeline: {
              create: {
                type: "CONSENT_CHANGE",
                description: `Opted-out of ${channel} communications via ${text} keyword.`,
              },
            },
          },
        });
      }

      // Add to suppression list
      await prisma.suppressionList.upsert({
        where: {
          companyId_value: {
            companyId,
            value: normalizedContact,
          },
        },
        create: {
          companyId,
          value: normalizedContact,
          reason: "UNSUBSCRIBE",
        },
        update: {
          reason: "UNSUBSCRIBE",
        },
      });

      return {
        isComplianceAction: true,
        replyText: isSms
          ? "You have successfully been unsubscribed. You will receive no further SMS alerts from this number. Reply START to resubscribe."
          : "You have been unsubscribed from all marketing emails.",
      };
    }

    if (startKeywords.includes(text) && isSms) {
      // 2. Opt-in/resubscribe
      for (const lead of leads) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            smsOptIn: true,
            consentSource: "SMS START Keyword",
            consentTimestamp: new Date(),
            timeline: {
              create: {
                type: "CONSENT_CHANGE",
                description: `Resubscribed to SMS communications via ${text} keyword.`,
              },
            },
          },
        });
      }

      // Remove from suppression list
      try {
        await prisma.suppressionList.delete({
          where: {
            companyId_value: {
              companyId,
              value: normalizedContact,
            },
          },
        });
      } catch {
        // Safe to ignore if not present in suppression list
      }

      return {
        isComplianceAction: true,
        replyText:
          "You have successfully resubscribed to SMS alerts. Standard message & data rates may apply. Reply STOP to opt out.",
      };
    }

    if (helpKeywords.includes(text) && isSms) {
      return {
        isComplianceAction: true,
        replyText:
          "Ai.Lumen Marketing Hub: For client assistance, reply to this thread. Msg & data rates may apply. Reply STOP to cancel.",
      };
    }

    return { isComplianceAction: false };
  }

  /**
   * Helper to format email HTML with required CAN-SPAM opt-out footer links
   */
  static addEmailUnsubscribeFooter(htmlContent, unsubscribeUrl, companyName) {
    const footerHtml = `
      <div style="margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 11px; color: #718096; text-align: center; line-height: 1.5;">
        <p>This email was sent by <strong>${companyName}</strong>.</p>
        <p>If you no longer wish to receive these emails, you can <a href="${unsubscribeUrl}" style="color: #b48c3c; text-decoration: underline;">unsubscribe here</a> at any time.</p>
        <p>&copy; 2026 ${companyName}. All rights reserved.</p>
      </div>
    `;

    // Try to inject before </body> if present, else append
    if (htmlContent.includes("</body>")) {
      return htmlContent.replace("</body>", `${footerHtml}</body>`);
    }
    return `${htmlContent}${footerHtml}`;
  }

  /**
   * Helper to append opt-out instructions to an SMS message
   */
  static addSmsOptOutSuffix(body) {
    const suffix = " Reply STOP to opt out.";
    if (body.toLowerCase().includes("reply stop")) {
      return body;
    }
    return `${body}${suffix}`;
  }
}
