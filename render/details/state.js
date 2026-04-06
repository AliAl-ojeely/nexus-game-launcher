// Session state for the details page
export const session = {
    startTime: 0,
    timerInterval: null,
    isHandlingStop: false
};

export function resetSession() {
    if (session.timerInterval) {
        clearInterval(session.timerInterval);
        session.timerInterval = null;
    }
    session.startTime = 0;
    session.isHandlingStop = false;
}