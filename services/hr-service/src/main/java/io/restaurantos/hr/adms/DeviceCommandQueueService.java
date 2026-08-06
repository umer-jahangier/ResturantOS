package io.restaurantos.hr.adms;

import org.springframework.stereotype.Service;

/**
 * Minimal command queue for the ADMS {@code getrequest} poll. Empty by default — the platform does
 * not push enroll-sync/reboot/time-sync commands yet, so the device is told there is nothing to do.
 * Kept as a seam so those commands can be queued later without changing the controller.
 */
@Service
public class DeviceCommandQueueService {

    /** Commands queued for a device serial, in ADMS text form. Empty = "no commands". */
    public String pendingCommandsFor(String serialNo) {
        return "";
    }

    /** Record a device's execution result for a previously-issued command. No-op today. */
    public void recordAck(String serialNo, String body) {
        // no queued commands yet, so nothing to reconcile
    }
}
