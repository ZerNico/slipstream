/**
 * XMLTV timestamps: `YYYYMMDDhhmmss +hhmm`. Seconds, minutes and hours may be left off from the
 * right, the offset may be missing (UTC per the XMLTV DTD), written without a space, or given as
 * `Z`, `UTC` or `GMT`.
 */
const TIMESTAMP =
  /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})?(\d{2})?)?\s*(?:([+-])(\d{2}):?(\d{2})|(Z|UTC|GMT))?$/i;

/**
 * Parses an XMLTV timestamp into epoch milliseconds, or `undefined` when it is not one.
 */
export const parseXmltvTime = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const match = TIMESTAMP.exec(value.trim());
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second, sign, offsetHours, offsetMinutes] = match;
  const parts = [year, month, day, hour ?? "0", minute ?? "0", second ?? "0"].map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const [y, mo, d, h, mi, s] = parts;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return undefined;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s);
  // Date.UTC rolls 31 February into March; a real feed never means that.
  if (new Date(utc).getUTCDate() !== d) return undefined;
  if (sign === undefined) return utc;
  const offset = (Number(offsetHours) * 60 + Number(offsetMinutes)) * 60_000;
  return sign === "+" ? utc - offset : utc + offset;
};
