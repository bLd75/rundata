import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

// Node gives the first address family 250 ms before trying the other one. From high-latency links (La Réunion
// to US servers) IPv4 takes longer than that, and where IPv6 has no route the request then times out.
setDefaultAutoSelectFamilyAttemptTimeout(2000);
