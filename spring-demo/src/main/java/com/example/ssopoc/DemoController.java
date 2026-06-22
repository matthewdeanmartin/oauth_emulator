package com.example.ssopoc;

import java.util.List;
import java.util.Map;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DemoController {

    /** Open endpoint, no auth. */
    @GetMapping("/public")
    public Map<String, Object> publicEndpoint() {
        return Map.of("message", "public ok", "authenticated", false);
    }

    /** Requires a valid bearer token. Echoes claims from the JWT. */
    @GetMapping("/api/me")
    public Map<String, Object> me(@AuthenticationPrincipal Jwt jwt) {
        return Map.of(
            "subject", jwt.getSubject(),
            "username", jwt.getClaimAsString("preferred_username"),
            "email", jwt.getClaimAsString("email"),
            "groups", jwt.getClaimAsStringList("groups")
        );
    }

    /** Requires the "admin" group (enforced in SecurityConfig). */
    @GetMapping("/api/admin")
    public Map<String, Object> admin(@AuthenticationPrincipal Jwt jwt) {
        List<String> groups = jwt.getClaimAsStringList("groups");
        return Map.of(
            "message", "admin ok",
            "subject", jwt.getSubject(),
            "groups", groups
        );
    }
}
