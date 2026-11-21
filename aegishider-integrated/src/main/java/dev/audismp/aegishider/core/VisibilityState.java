package dev.audismp.aegishider.core;

/**
 * The only visibility states a protected object can be in.
 *
 * <p>Only {@link #VISIBLE} and {@link #BYPASS} allow real data to be transmitted
 * to a client. Every other state - including {@link #UNKNOWN} and {@link #PENDING} -
 * must fail closed and keep the data hidden.
 */
public enum VisibilityState {

    /** Data may be sent: the policy positively proved visibility. */
    VISIBLE,
    /** Data must not be sent and, if already sent, must be removed/faked. */
    HIDDEN,
    /** Computation not finished yet: still hidden, data may not be sent. */
    PENDING,
    /** No information available: treat exactly like HIDDEN. */
    UNKNOWN,
    /** Explicit, permission-checked bypass: data may be sent unchanged. */
    BYPASS;

    public boolean maySendData() {
        return this == VISIBLE || this == BYPASS;
    }

    /** Fail-closed default for any object under protection. */
    public static VisibilityState failClosed() {
        return UNKNOWN;
    }
}
