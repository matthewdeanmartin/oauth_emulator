package com.example.ssopoc;

import static io.gatling.javaapi.core.CoreDsl.*;
import static io.gatling.javaapi.http.HttpDsl.*;

import io.gatling.javaapi.core.ScenarioBuilder;
import io.gatling.javaapi.core.Simulation;
import io.gatling.javaapi.http.HttpProtocolBuilder;

/**
 * Unattended authenticated API test.
 *
 * Proves the real-world flow without a human:
 *   1. "Sign in" at the mock IdP -> receive a signed JWT (no password prompt).
 *   2. Send that JWT as a Bearer token to the Spring resource server.
 *   3. The server validates signature + issuer and applies claim-based rules.
 *
 * This is the same validation path a production SSO token would hit. No token
 * validation is bypassed anywhere; Gatling only carries the token.
 */
public class SsoSimulation extends Simulation {

    private static final String IDP_URL =
        System.getProperty("idp.url", "http://localhost:9000");
    private static final String API_URL =
        System.getProperty("api.url", "http://localhost:8080");
    private static final int USERS =
        Integer.getInteger("users", 1);
    private static final int DURATION =
        Integer.getInteger("duration", 0); // seconds; 0 => single iteration

    private final HttpProtocolBuilder httpProtocol = http
        .baseUrl(API_URL)
        .acceptHeader("application/json");

    private final ScenarioBuilder scenario = scenario("Unattended authenticated API test")
        // 1. Sign in at the mock IdP and capture the access token.
        .exec(http("Login (mock IdP)")
            .post(IDP_URL + "/login")
            .formParam("username", "demo.user")
            .check(status().is(200))
            .check(jsonPath("$.access_token").exists().saveAs("token")))

        // 2. Public endpoint, no auth.
        .exec(http("GET /public")
            .get("/public")
            .check(status().is(200)))

        // 3. Protected endpoint with bearer token.
        .exec(http("GET /api/me")
            .get("/api/me")
            .header("Authorization", "Bearer #{token}")
            .check(status().is(200))
            .check(jsonPath("$.subject").is("user-123")))

        // 4. Admin endpoint with bearer token (demo.user is in "admin").
        .exec(http("GET /api/admin")
            .get("/api/admin")
            .header("Authorization", "Bearer #{token}")
            .check(status().is(200)));

    {
        // Default: 1 user, 1 iteration (the acceptance criteria).
        // Optional load profile: -Dusers=10 -Dduration=30
        if (DURATION > 0) {
            setUp(scenario.injectOpen(
                    constantUsersPerSec(USERS).during(DURATION)))
                .protocols(httpProtocol)
                .assertions(global().failedRequests().count().is(0L));
        } else {
            setUp(scenario.injectOpen(atOnceUsers(USERS)))
                .protocols(httpProtocol)
                .assertions(global().failedRequests().count().is(0L));
        }
    }
}
