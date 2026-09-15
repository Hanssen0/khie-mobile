package libs.general.bluetooth.le;

import android.annotation.*;

@SuppressLint({ "InlinedApi" })
public class GattError extends Exception
{
    private static final long serialVersionUID = -3443529515116293760L;
    private int mReason;

    public GattError(final String message, final int reason) {
        super(message);
        this.mReason = 0;
        this.mReason = reason;
    }

    public GattError(final String message) {
        super(message);
        this.mReason = 0;
    }

    public int getReason() {
        return this.mReason;
    }
}
