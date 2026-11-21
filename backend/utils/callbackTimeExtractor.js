/**
 * AI Callback Intent & Natural Language Date-Time Extraction Utility
 * 
 * Extracts and calculates exact callback dates and times from natural-language
 * expressions in Hindi, English, and Hinglish relative to the call timestamp
 * and customer/tenant timezone (default: Asia/Kolkata).
 */

const DEFAULT_TIMEZONE = "Asia/Kolkata"

// Hindi and Hinglish number words
const HINDI_NUMBER_WORDS = {
  ek: 1,
  do: 2,
  teen: 3,
  char: 4,
  paanch: 5,
  panch: 6,
  che: 6,
  chhe: 6,
  saat: 7,
  aath: 8,
  nau: 9,
  das: 10,
  gyarah: 11,
  barah: 12,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}

// Day of week mapping
const DAYS_OF_WEEK = {
  sunday: 0,
  sun: 0,
  ravivar: 0,
  itwar: 0,
  monday: 1,
  mon: 1,
  somvar: 1,
  somwar: 1,
  tuesday: 2,
  tue: 2,
  mangalvar: 2,
  mangalwar: 2,
  wednesday: 3,
  wed: 3,
  budhvar: 3,
  budhwar: 3,
  thursday: 4,
  thu: 4,
  guruvar: 4,
  guruwar: 4,
  veervar: 4,
  friday: 5,
  fri: 5,
  shukravar: 5,
  shukrawar: 5,
  saturday: 6,
  sat: 6,
  shanivar: 6,
  shaniwar: 6,
}

// Regex patterns indicating callback desire
const CALLBACK_INTENT_PATTERNS = [
  /call\s*(?:me\s*)?(?:back|again)/i,
  /callback/i,
  /phone\s*karna/i,
  /call\s*karna/i,
  /baat\s*karna/i,
  /baat\s*karte\s*hain/i,
  /contact\s*(?:me\s*)?(?:later|tomorrow)/i,
  /reach\s*out/i,
  /connect\s*later/i,
  /phir\s*se\s*call/i,
  /baad\s*mein\s*call/i,
  /baad\s*me\s*call/i,
]

/**
 * Gets date components in a specific IANA timezone
 */
function getZonedDateParts(dateObj, timezone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
    weekday: "long",
  })

  const parts = formatter.formatToParts(dateObj)
  const map = {}
  for (const p of parts) {
    map[p.type] = p.value
  }

  return {
    year: Number(map.year),
    month: Number(map.month), // 1-12
    day: Number(map.day),
    hour: Number(map.hour === "24" ? 0 : map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: map.weekday.toLowerCase(),
  }
}

/**
 * Constructs a UTC Date object representing a specific local date/time in the specified timezone
 */
function createZonedDate({ year, month, day, hour = 10, minute = 0, second = 0 }, timezone = DEFAULT_TIMEZONE) {
  // ISO format string for local time
  const pad = (n) => String(n).padStart(2, "0")
  const localIso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`

  // Use Intl to compute offset
  // We approximate using UTC then adjust by timezone offset
  const testUtc = new Date(`${localIso}Z`)
  const zonedParts = getZonedDateParts(testUtc, timezone)

  // Difference between target local time and the zoned parts computed from testUtc
  const targetEpoch = Date.UTC(year, month - 1, day, hour, minute, second)
  const computedZonedEpoch = Date.UTC(
    zonedParts.year,
    zonedParts.month - 1,
    zonedParts.day,
    zonedParts.hour,
    zonedParts.minute,
    zonedParts.second
  )

  const diffMs = targetEpoch - computedZonedEpoch
  return new Date(testUtc.getTime() + diffMs)
}

function normalizeLangCode(lang) {
  if (!lang) return "en"
  const l = String(lang).toLowerCase()
  if (l === "hi" || l.includes("hindi")) return "hi"
  if (l.includes("hing")) return "hinglish"
  return "en"
}

/**
 * Parses natural language callback expressions from transcript text
 * 
 * @param {string} text - Transcript or customer message text
 * @param {Object} options
 * @param {Date|number} [options.referenceTimestamp] - Call start time (defaults to Date.now())
 * @param {string} [options.timezone] - IANA timezone (defaults to Asia/Kolkata)
 * @returns {Object} Extracted callback details
 */
function extractCallbackIntent(text = "", options = {}) {
  if (!text || typeof text !== "string") {
    return { callbackRequested: false }
  }

  const referenceDate = options.referenceTimestamp ? new Date(options.referenceTimestamp) : new Date()
  const timezone = options.timezone || DEFAULT_TIMEZONE
  const lower = text.toLowerCase().trim()

  // 1. Check if callback intent exists
  const hasCallbackIntent = CALLBACK_INTENT_PATTERNS.some((p) => p.test(lower))
  const mentionsTime = /(?:kal|parso|aaj|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|somwar|somvar|mangalwar|budhwar|guruwar|veervar|shukrawar|shaniwar|ravivar|baje|am|pm|subah|shaam|dophar|after\s*lunch|minutes?|ghante?|hours?)/i.test(lower)

  if (!hasCallbackIntent && !mentionsTime) {
    return {
      callbackRequested: false,
    }
  }

  // 2. Detect language
  let language = "English"
  if (/[\u0900-\u097F]/.test(text)) {
    language = "Hindi"
  } else if (/(?:karna|karein|baat|subah|shaam|dophar|baje|parso|aaj|kal|hum|aap|mera|meri|hai|nahi|thik|theek|baad)/i.test(lower)) {
    language = "Hinglish"
  }

  // Current components in target timezone
  const refParts = getZonedDateParts(referenceDate, timezone)

  let targetDayOffset = 0 // 0 = today, 1 = tomorrow, 2 = day after tomorrow
  let targetWeekday = null
  let relativeMinutes = null
  let isRelativeOffset = false

  // Determine target date offset
  if (/\b(?:parso|parson|day\s*after\s*tomorrow)\b/i.test(lower)) {
    targetDayOffset = 2
  } else if (/\b(?:kal|tomorrow)\b/i.test(lower)) {
    targetDayOffset = 1
  } else if (/\b(?:aaj|today)\b/i.test(lower)) {
    targetDayOffset = 0
  } else {
    // Check for days of week
    for (const [dayName, dayIndex] of Object.entries(DAYS_OF_WEEK)) {
      const regex = new RegExp(`\\b(?:next\\s+)?${dayName}\\b`, "i")
      if (regex.test(lower)) {
        targetWeekday = dayIndex
        break
      }
    }
  }

  // Check for relative time like "30 minutes baad", "after 1 hour", "2 ghante baad", "aadhe ghante baad"
  const relMinMatch = lower.match(/(\d+|aadhe|adhe|aadha|adha|half|ek|do|teen|char|one|two)\s*(?:minute|minutes|min|mins|ghanta|ghante|ghanto|hour|hours|hr|hrs)?\s*(?:baad|me|mein|after|later)\b/i)
  if (relMinMatch) {
    const rawVal = relMinMatch[1].toLowerCase()
    let qty = 1
    if (rawVal.startsWith("aadh") || rawVal === "half") {
      qty = 30
      relativeMinutes = 30
      isRelativeOffset = true
    } else {
      qty = HINDI_NUMBER_WORDS[rawVal] || Number(rawVal) || 1
      const isHours = /(?:ghanta|ghante|ghanto|hour|hours|hr|hrs)/i.test(relMinMatch[0])
      relativeMinutes = isHours ? qty * 60 : qty
      isRelativeOffset = true
    }
  }

  // Extract explicit time (e.g. "11 baje", "10:30 am", "5 PM", "after lunch")
  let targetHour = 10 // default 10:00 AM
  let targetMinute = 0
  let precision = "APPROXIMATE"

  if (isRelativeOffset && relativeMinutes !== null) {
    // Relative calculation from referenceDate
    const exactTarget = new Date(referenceDate.getTime() + relativeMinutes * 60 * 1000)
    precision = "EXACT"

    const voiceConfirmation = generateVoiceConfirmation({
      dateObj: exactTarget,
      language,
      timezone,
      isRelative: true,
      relativeMinutes,
    })

    return {
      callbackRequested: true,
      requestedCallbackDateTime: exactTarget.toISOString(),
      callbackTimezone: timezone,
      callbackTimePrecision: precision,
      callbackReason: extractCallbackReason(lower),
      callbackLanguage: normalizeLangCode(language),
      voiceConfirmation,
    }
  }

  // Parse hour and minute
  // 1. Check patterns like "10:30", "11:15"
  const colonTimeMatch = lower.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i)
  // 2. Check patterns like "11 baje", "11 am", "5 pm", "11:00 baje"
  const bajeMatch = lower.match(/\b(\d{1,2}|ek|do|teen|char|paanch|panch|che|chhe|saat|aath|nau|das|gyarah|barah|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:baje|am|pm|o'clock)?\b/i)

  const isPm = /\b(?:pm|shaam|dophar|raat|evening|afternoon|night)\b/i.test(lower)
  const isAm = /\b(?:am|subah|morning)\b/i.test(lower)
  const isAfterLunch = /\bafter\s*lunch\b/i.test(lower)

  if (colonTimeMatch) {
    let h = Number(colonTimeMatch[1])
    const m = Number(colonTimeMatch[2])
    const meridiem = (colonTimeMatch[3] || "").toLowerCase()

    if (meridiem === "pm" && h < 12) h += 12
    if (meridiem === "am" && h === 12) h = 0
    if (!meridiem && isPm && h < 12) h += 12

    targetHour = h
    targetMinute = m
    precision = "EXACT"
  } else if (bajeMatch) {
    const rawNum = bajeMatch[1].toLowerCase()
    let h = HINDI_NUMBER_WORDS[rawNum] !== undefined ? HINDI_NUMBER_WORDS[rawNum] : Number(rawNum)
    if (!isNaN(h) && h >= 1 && h <= 24) {
      if (h <= 12) {
        if (isPm && h < 12) h += 12
        else if (isAm && h === 12) h = 0
        else if (!isAm && !isPm) {
          // Heuristic: hours 1 to 7 are usually PM for callbacks unless specified morning
          if (h >= 1 && h <= 7) h += 12
        }
      }
      targetHour = h
      targetMinute = 0
      precision = "EXACT"
    }
  } else if (isAfterLunch) {
    targetHour = 14
    targetMinute = 0
    precision = "APPROXIMATE"
  } else if (isPm) {
    targetHour = 17
    targetMinute = 0
    precision = "APPROXIMATE"
  } else if (isAm) {
    targetHour = 10
    targetMinute = 0
    precision = "APPROXIMATE"
  }

  // Calculate target calendar date in target timezone
  let targetYear = refParts.year
  let targetMonth = refParts.month
  let targetDay = refParts.day

  if (targetWeekday !== null) {
    // Current weekday in target timezone
    const currentWeekdayIndex = DAYS_OF_WEEK[refParts.weekday] !== undefined ? DAYS_OF_WEEK[refParts.weekday] : referenceDate.getUTCDay()
    let daysToAdd = (targetWeekday - currentWeekdayIndex + 7) % 7
    if (daysToAdd === 0) daysToAdd = 7 // Next week if same day specified
    targetDayOffset = daysToAdd
  }

  // If time specified for today has already passed, bump to tomorrow
  if (targetDayOffset === 0 && targetWeekday === null) {
    if (targetHour < refParts.hour || (targetHour === refParts.hour && targetMinute <= refParts.minute)) {
      // If user says "call at 11 AM" but it's already 3 PM today, they mean tomorrow
      if (!/\b(?:aaj|today)\b/i.test(lower)) {
        targetDayOffset = 1
      }
    }
  }

  // Advance by targetDayOffset days
  const baseLocal = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay + targetDayOffset))
  targetYear = baseLocal.getUTCFullYear()
  targetMonth = baseLocal.getUTCMonth() + 1
  targetDay = baseLocal.getUTCDate()

  const finalZonedDate = createZonedDate(
    {
      year: targetYear,
      month: targetMonth,
      day: targetDay,
      hour: targetHour,
      minute: targetMinute,
      second: 0,
    },
    timezone
  )

  const voiceConfirmation = generateVoiceConfirmation({
    dateObj: finalZonedDate,
    language,
    timezone,
    isRelative: false,
    targetHour,
    targetMinute,
    dayOffset: targetDayOffset,
  })

  return {
    callbackRequested: true,
    requestedCallbackDateTime: finalZonedDate.toISOString(),
    callbackTimezone: timezone,
    callbackTimePrecision: precision,
    callbackReason: extractCallbackReason(lower),
    callbackLanguage: normalizeLangCode(language),
    voiceConfirmation,
  }
}

/**
 * Extracts reason for callback if provided
 */
function extractCallbackReason(lowerText) {
  if (lowerText.includes("busy") || lowerText.includes("driving") || lowerText.includes("meeting")) {
    return "Customer is currently busy / in meeting"
  }
  if (lowerText.includes("demo") || lowerText.includes("walkthrough") || lowerText.includes("presentation")) {
    return "Product walkthrough and demo request"
  }
  if (lowerText.includes("pricing") || lowerText.includes("quote") || lowerText.includes("cost") || lowerText.includes("commercials")) {
    return "Pricing and commercial terms discussion"
  }
  if (lowerText.includes("proposal") || lowerText.includes("details") || lowerText.includes("brochure")) {
    return "Detailed proposal and feature review"
  }
  return "Customer requested future callback"
}

/**
 * Generates natural verbal AI voice confirmation
 */
function generateVoiceConfirmation({ dateObj, language, timezone, isRelative, relativeMinutes, targetHour, targetMinute, dayOffset }) {
  const parts = getZonedDateParts(dateObj, timezone)
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12
  const ampm = parts.hour >= 12 ? "PM" : "AM"
  const minStr = parts.minute > 0 ? `:${String(parts.minute).padStart(2, "0")}` : ""
  const timeFormatted = `${hour12}${minStr} ${ampm}`

  if (language === "Hindi" || language === "Hinglish") {
    if (isRelative) {
      const minText = relativeMinutes >= 60 ? `${Math.round(relativeMinutes / 60)} ghante` : `${relativeMinutes} minute`
      return `Bilkul sir. Main aapko ${minText} baad call karta hoon.`
    }

    let dayWord = "aaj"
    if (dayOffset === 1) dayWord = "kal"
    else if (dayOffset === 2) dayWord = "parso"
    else if (dayOffset > 2) dayWord = `${parts.weekday}`

    let timePeriod = "baje"
    if (parts.hour < 12) timePeriod = "subah"
    else if (parts.hour < 16) timePeriod = "dophar"
    else timePeriod = "shaam"

    return `Bilkul sir. Main aapka callback ${dayWord} ${timePeriod} ${hour12}${minStr} baje schedule kar raha hoon.`
  }

  // English
  if (isRelative) {
    const minText = relativeMinutes >= 60 ? `${Math.round(relativeMinutes / 60)} hour(s)` : `${relativeMinutes} minutes`
    return `Certainly sir. I am scheduling a callback in ${minText} at ${timeFormatted}.`
  }

  let dayWord = "today"
  if (dayOffset === 1) dayWord = "tomorrow"
  else if (dayOffset === 2) dayWord = "the day after tomorrow"
  else if (dayOffset > 2) dayWord = `on ${parts.weekday}`

  return `Certainly sir. A callback has been scheduled for ${dayWord} at ${timeFormatted}.`
}

module.exports = {
  DEFAULT_TIMEZONE,
  extractCallbackIntent,
  createZonedDate,
  getZonedDateParts,
  generateVoiceConfirmation,
}
