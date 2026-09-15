package libs.general.util;

public class XOR implements ChecksumEx
{
    private long initValue;
    private long checksum;

    public XOR() {
        this.initValue = 0L;
        this.checksum = this.initValue;
    }

    public XOR(final long value) {
        this.initValue = 0L;
        this.checksum = this.initValue;
        this.initValue = value;
        this.checksum = this.initValue;
    }

    @Override
    public long getValue() {
        return this.checksum;
    }

    @Override
    public void reset() {
        this.checksum = this.initValue;
    }

    @Override
    public void update(final int arg0) {
        this.checksum ^= arg0;
    }

    @Override
    public void update(final byte[] arg0, final int arg1, final int arg2) {
        for (int i = arg1; i < arg2; ++i) {
            this.checksum ^= arg0[i];
        }
    }

    @Override
    public int getLength() {
        return 1;
    }
}
