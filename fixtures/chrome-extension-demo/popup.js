const statusLabel = document.getElementById("status-label");

document.querySelector(".schedule-form").addEventListener("submit", (event) => {
  event.preventDefault();
  statusLabel.textContent = "Scheduled";
});

document.getElementById("cancel").addEventListener("click", () => {
  statusLabel.textContent = "Not scheduled";
});
