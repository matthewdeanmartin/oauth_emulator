package com.example.ssopoc;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Security-rule tests using mock JWTs. Avoids needing the live mock IdP by
 * overriding the JWT decoder; the authorization rules under test are the same.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    // Point at a (non-running) issuer; the decoder is mocked by jwt() below,
    // so no network call happens. Avoids startup hitting a real discovery URL.
    "spring.security.oauth2.resourceserver.jwt.jwk-set-uri=http://localhost:9999/jwks"
})
class DemoControllerTest {

    @Autowired
    MockMvc mvc;

    @Test
    void publicEndpoint_noAuth_ok() throws Exception {
        mvc.perform(get("/public")).andExpect(status().isOk());
    }

    @Test
    void me_noToken_unauthorized() throws Exception {
        mvc.perform(get("/api/me")).andExpect(status().isUnauthorized());
    }

    @Test
    void me_withToken_returnsClaims() throws Exception {
        mvc.perform(get("/api/me").with(jwt().jwt(j -> j
                .subject("user-123")
                .claim("preferred_username", "demo.user")
                .claim("email", "demo.user@example.test")
                .claim("groups", java.util.List.of("demo-users", "admin")))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.subject").value("user-123"))
            .andExpect(jsonPath("$.username").value("demo.user"));
    }

    @Test
    void admin_withAdminGroup_ok() throws Exception {
        mvc.perform(get("/api/admin").with(jwt()
                .jwt(j -> j.subject("user-123").claim("groups", java.util.List.of("admin")))
                .authorities(new SimpleGrantedAuthority("ROLE_admin"))))
            .andExpect(status().isOk());
    }

    @Test
    void admin_withoutAdminGroup_forbidden() throws Exception {
        mvc.perform(get("/api/admin").with(jwt()
                .jwt(j -> j.subject("user-456").claim("groups", java.util.List.of("demo-users")))
                .authorities(new SimpleGrantedAuthority("ROLE_demo-users"))))
            .andExpect(status().isForbidden());
    }
}
