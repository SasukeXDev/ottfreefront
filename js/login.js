(function () {
  const form = document.getElementById("login-form");
  const errBox = document.getElementById("auth-error");
  const btn = document.getElementById("submit-btn");

  function showError(msg) {
    errBox.textContent = msg;
    errBox.classList.add("is-visible");
  }

  async function main() {
    const { data } = await OttfreeAPI.loginState();
    if (data && data.authenticated) {
      const next = OttfreeUtils.getParam("next");
      location.href = next || "home.html";
      return;
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errBox.classList.remove("is-visible");
      btn.disabled = true;
      btn.textContent = "Signing in…";
      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value;
      try {
        const { data, ok } = await OttfreeAPI.login(username, password);
        if (ok && data && data.authenticated) {
          try { sessionStorage.setItem("ottfree:isAdmin", data.is_admin ? "1" : "0"); } catch (e) {}
          const back = OttfreeUtils.getParam("next");
          location.href = back || "home.html";
        } else {
          showError((data && data.error) || "Invalid username or password.");
        }
      } catch (e) {
        showError("Couldn't reach the backend. Check js/config.js.");
      } finally {
        btn.disabled = false;
        btn.textContent = "Sign in";
      }
    });
  }

  main();
})();
