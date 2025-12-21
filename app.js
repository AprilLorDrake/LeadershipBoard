// GitHub API Configuration
const GITHUB_API_BASE = 'https://api.github.com';

// Store for dashboard data
let dashboardData = {
    contributors: [],
    totalCommits: 0,
    totalPRs: 0,
    totalReviews: 0,
    totalIssues: 0,
    activityData: [],
    languages: {}
};

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    const loadDataBtn = document.getElementById('load-data-btn');
    loadDataBtn.addEventListener('click', loadDashboard);

    // Allow Enter key to trigger load
    document.querySelectorAll('.config-card input').forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadDashboard();
        });
    });
});

// Main function to load dashboard data
async function loadDashboard() {
    const token = document.getElementById('github-token').value.trim();
    const org = document.getElementById('github-org').value.trim();
    const repo = document.getElementById('github-repo').value.trim();
    const timeRange = parseInt(document.getElementById('time-range').value);

    if (!org) {
        showError('Please enter an organization or username');
        return;
    }

    showLoading(true);
    hideError();

    try {
        // Calculate date range
        const since = new Date();
        since.setDate(since.getDate() - timeRange);
        const sinceISO = since.toISOString();

        // Fetch data
        const repos = repo ? [repo] : await fetchRepositories(org, token);
        
        if (repos.length === 0) {
            throw new Error('No repositories found');
        }

        // Reset data
        resetDashboardData();

        // Fetch data for each repository
        for (const repoName of repos) {
            await fetchRepositoryData(org, repoName, token, sinceISO);
        }

        // Calculate scores and render
        calculateContributorScores();
        renderDashboard();
        
        document.getElementById('dashboard').classList.remove('hidden');
        document.getElementById('last-update').textContent = new Date().toLocaleString();
        
    } catch (error) {
        console.error('Error loading dashboard:', error);
        showError(error.message || 'Failed to load GitHub data. Please check your credentials and try again.');
    } finally {
        showLoading(false);
    }
}

// Fetch list of repositories
async function fetchRepositories(org, token) {
    const headers = createHeaders(token);
    const response = await fetch(`${GITHUB_API_BASE}/users/${org}/repos?per_page=100`, { headers });
    
    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Organization or user not found');
        } else if (response.status === 403) {
            throw new Error('API rate limit exceeded. Please provide a GitHub token.');
        }
        throw new Error(`GitHub API error: ${response.status}`);
    }
    
    const repos = await response.json();
    return repos.map(r => r.name).slice(0, 10); // Limit to 10 repos to avoid rate limiting
}

// Fetch data for a single repository
async function fetchRepositoryData(owner, repo, token, since) {
    const headers = createHeaders(token);

    try {
        // Fetch commits
        const commits = await fetchPaginated(`${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?since=${since}`, headers);
        processCommits(commits);

        // Fetch pull requests
        const prs = await fetchPaginated(`${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls?state=all&since=${since}`, headers);
        processPullRequests(prs);

        // Fetch issues
        const issues = await fetchPaginated(`${GITHUB_API_BASE}/repos/${owner}/${repo}/issues?state=closed&since=${since}`, headers);
        processIssues(issues);

        // Fetch languages
        const langResponse = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/languages`, { headers });
        if (langResponse.ok) {
            const languages = await langResponse.json();
            processLanguages(languages);
        }

    } catch (error) {
        console.error(`Error fetching data for ${owner}/${repo}:`, error);
    }
}

// Helper function to fetch paginated results
async function fetchPaginated(url, headers, maxPages = 3) {
    const results = [];
    let page = 1;

    while (page <= maxPages) {
        const pageUrl = `${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`;
        const response = await fetch(pageUrl, { headers });
        
        if (!response.ok) break;
        
        const data = await response.json();
        if (data.length === 0) break;
        
        results.push(...data);
        page++;
    }

    return results;
}

// Process commits data
function processCommits(commits) {
    dashboardData.totalCommits += commits.length;
    
    commits.forEach(commit => {
        if (!commit.author) return;
        
        const author = commit.author.login;
        const date = new Date(commit.commit.author.date);
        
        addContributor(author, commit.author.avatar_url);
        dashboardData.contributors[author].commits++;
        
        // Track daily activity
        const dayKey = date.toISOString().split('T')[0];
        if (!dashboardData.activityData[dayKey]) {
            dashboardData.activityData[dayKey] = 0;
        }
        dashboardData.activityData[dayKey]++;
    });
}

// Process pull requests data
function processPullRequests(prs) {
    // Filter out pull requests that are actually issues
    const actualPRs = prs.filter(pr => !pr.pull_request || pr.pull_request);
    dashboardData.totalPRs += actualPRs.length;
    
    actualPRs.forEach(pr => {
        if (!pr.user) return;
        
        const author = pr.user.login;
        addContributor(author, pr.user.avatar_url);
        dashboardData.contributors[author].prs++;
        
        // Count reviews
        if (pr.requested_reviewers) {
            pr.requested_reviewers.forEach(reviewer => {
                addContributor(reviewer.login, reviewer.avatar_url);
                dashboardData.contributors[reviewer.login].reviews++;
                dashboardData.totalReviews++;
            });
        }
    });
}

// Process issues data
function processIssues(issues) {
    // Filter out pull requests (GitHub API returns PRs as issues)
    const actualIssues = issues.filter(issue => !issue.pull_request);
    dashboardData.totalIssues += actualIssues.length;
    
    actualIssues.forEach(issue => {
        if (!issue.user) return;
        
        const author = issue.user.login;
        addContributor(author, issue.user.avatar_url);
        dashboardData.contributors[author].issues++;
    });
}

// Process languages data
function processLanguages(languages) {
    Object.keys(languages).forEach(lang => {
        if (!dashboardData.languages[lang]) {
            dashboardData.languages[lang] = 0;
        }
        dashboardData.languages[lang] += languages[lang];
    });
}

// Add or update contributor
function addContributor(username, avatarUrl) {
    if (!dashboardData.contributors[username]) {
        dashboardData.contributors[username] = {
            username,
            avatarUrl,
            commits: 0,
            prs: 0,
            reviews: 0,
            issues: 0,
            score: 0
        };
    }
}

// Calculate contributor scores
function calculateContributorScores() {
    Object.values(dashboardData.contributors).forEach(contributor => {
        // Weighted scoring system
        contributor.score = 
            (contributor.commits * 1) +
            (contributor.prs * 5) +
            (contributor.reviews * 3) +
            (contributor.issues * 2);
    });
}

// Render the dashboard
function renderDashboard() {
    renderStats();
    renderLeaderboard();
    renderActivityChart();
    renderLanguages();
    renderContributorsTable();
}

// Render top stats
function renderStats() {
    document.getElementById('total-commits').textContent = dashboardData.totalCommits.toLocaleString();
    document.getElementById('total-prs').textContent = dashboardData.totalPRs.toLocaleString();
    document.getElementById('total-reviews').textContent = dashboardData.totalReviews.toLocaleString();
    document.getElementById('total-issues').textContent = dashboardData.totalIssues.toLocaleString();
    
    // Mock percentage changes (would need historical data for real values)
    setStatChange('commits-change', '+12%', true);
    setStatChange('prs-change', '+8%', true);
    setStatChange('reviews-change', '+15%', true);
    setStatChange('issues-change', '-3%', false);
}

function setStatChange(elementId, text, isPositive) {
    const element = document.getElementById(elementId);
    element.textContent = text;
    element.classList.toggle('positive', isPositive);
    element.classList.toggle('negative', !isPositive);
}

// Render leaderboard
function renderLeaderboard() {
    const sortedContributors = Object.values(dashboardData.contributors)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    
    const leaderboardList = document.getElementById('leaderboard-list');
    leaderboardList.innerHTML = '';
    
    sortedContributors.forEach((contributor, index) => {
        const rank = index + 1;
        const rankClass = rank <= 3 ? `rank-${rank}` : 'rank-other';
        
        const item = document.createElement('div');
        item.className = 'leaderboard-item';
        item.innerHTML = `
            <div class="rank-badge ${rankClass}">${rank}</div>
            <div class="contributor-info">
                <div class="contributor-name">${contributor.username}</div>
                <div class="contributor-stats">
                    ${contributor.commits} commits • ${contributor.prs} PRs • ${contributor.reviews} reviews
                </div>
            </div>
            <div class="contributor-score">${contributor.score}</div>
        `;
        
        leaderboardList.appendChild(item);
    });
}

// Render activity chart (simple bar chart using canvas)
function renderActivityChart() {
    const canvas = document.getElementById('activity-chart');
    const ctx = canvas.getContext('2d');
    
    // Set canvas size
    canvas.width = canvas.offsetWidth;
    canvas.height = 300;
    
    // Get last 7 days of activity
    const sortedDates = Object.keys(dashboardData.activityData).sort();
    const last7Days = sortedDates.slice(-7);
    const values = last7Days.map(date => dashboardData.activityData[date] || 0);
    const maxValue = Math.max(...values, 1);
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw bars
    const barWidth = canvas.width / 7 - 20;
    const barSpacing = 10;
    
    values.forEach((value, index) => {
        const barHeight = (value / maxValue) * (canvas.height - 50);
        const x = index * (barWidth + barSpacing) + barSpacing;
        const y = canvas.height - barHeight - 30;
        
        // Draw bar
        const gradient = ctx.createLinearGradient(0, y, 0, canvas.height);
        gradient.addColorStop(0, '#58a6ff');
        gradient.addColorStop(1, '#3fb950');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, barWidth, barHeight);
        
        // Draw value
        ctx.fillStyle = '#c9d1d9';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(value, x + barWidth / 2, y - 5);
        
        // Draw date label
        const date = new Date(last7Days[index]);
        const label = date.toLocaleDateString('en-US', { weekday: 'short' });
        ctx.fillStyle = '#8b949e';
        ctx.fillText(label, x + barWidth / 2, canvas.height - 10);
    });
}

// Render languages
function renderLanguages() {
    const languagesList = document.getElementById('languages-list');
    languagesList.innerHTML = '';
    
    const totalBytes = Object.values(dashboardData.languages).reduce((a, b) => a + b, 0);
    
    if (totalBytes === 0) {
        languagesList.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No language data available</p>';
        return;
    }
    
    const languageColors = {
        'JavaScript': '#f1e05a',
        'TypeScript': '#3178c6',
        'Python': '#3572A5',
        'Java': '#b07219',
        'Go': '#00ADD8',
        'Rust': '#dea584',
        'Ruby': '#701516',
        'PHP': '#4F5D95',
        'C++': '#f34b7d',
        'C#': '#178600',
        'HTML': '#e34c26',
        'CSS': '#563d7c'
    };
    
    const sortedLanguages = Object.entries(dashboardData.languages)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    sortedLanguages.forEach(([lang, bytes]) => {
        const percentage = ((bytes / totalBytes) * 100).toFixed(1);
        const color = languageColors[lang] || '#8b949e';
        
        const item = document.createElement('div');
        item.className = 'language-item';
        item.innerHTML = `
            <div class="language-color" style="background: ${color}"></div>
            <div class="language-name">${lang}</div>
            <div class="language-percentage">${percentage}%</div>
        `;
        
        languagesList.appendChild(item);
    });
}

// Render contributors table
function renderContributorsTable() {
    const tbody = document.getElementById('contributors-tbody');
    tbody.innerHTML = '';
    
    const sortedContributors = Object.values(dashboardData.contributors)
        .sort((a, b) => b.score - a.score);
    
    sortedContributors.forEach((contributor, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${contributor.username}</td>
            <td>${contributor.commits}</td>
            <td>${contributor.prs}</td>
            <td>${contributor.reviews}</td>
            <td>${contributor.issues}</td>
            <td>${contributor.score}</td>
        `;
        
        tbody.appendChild(row);
    });
}

// Helper functions
function createHeaders(token) {
    const headers = {
        'Accept': 'application/vnd.github.v3+json'
    };
    
    if (token) {
        headers['Authorization'] = `token ${token}`;
    }
    
    return headers;
}

function resetDashboardData() {
    dashboardData = {
        contributors: {},
        totalCommits: 0,
        totalPRs: 0,
        totalReviews: 0,
        totalIssues: 0,
        activityData: {},
        languages: {}
    };
}

function showLoading(show) {
    document.getElementById('loading').classList.toggle('hidden', !show);
    document.getElementById('load-data-btn').disabled = show;
}

function showError(message) {
    document.getElementById('error-text').textContent = message;
    document.getElementById('error-message').classList.remove('hidden');
}

function hideError() {
    document.getElementById('error-message').classList.add('hidden');
}
