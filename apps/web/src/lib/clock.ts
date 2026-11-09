/** "0:42", "12:05": minutes and seconds, for short stretches like a distraction. */
export const clockOf = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
