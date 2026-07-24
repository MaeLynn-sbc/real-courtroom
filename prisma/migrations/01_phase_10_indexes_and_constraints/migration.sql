-- CreateIndex
CREATE INDEX "EquipmentRental_equipmentId_idx" ON "EquipmentRental"("equipmentId");

-- CreateIndex
CREATE INDEX "LockerRental_lockerId_idx" ON "LockerRental"("lockerId");

-- CreateIndex
CREATE INDEX "Match_team1Id_idx" ON "Match"("team1Id");

-- CreateIndex
CREATE INDEX "Match_team2Id_idx" ON "Match"("team2Id");

-- CreateIndex
CREATE INDEX "Match_winnerTeamId_idx" ON "Match"("winnerTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_tournamentCategoryId_round_bracketPosition_key" ON "Match"("tournamentCategoryId", "round", "bracketPosition");

-- CreateIndex
CREATE INDEX "MembershipHistory_createdAt_idx" ON "MembershipHistory"("createdAt");

-- CreateIndex
CREATE INDEX "OpenPlayQueue_courtId_idx" ON "OpenPlayQueue"("courtId");

-- CreateIndex
CREATE INDEX "Player_deletedAt_idx" ON "Player"("deletedAt");

-- CreateIndex
CREATE INDEX "Team_player1Id_idx" ON "Team"("player1Id");

-- CreateIndex
CREATE INDEX "Team_player2Id_idx" ON "Team"("player2Id");

-- CreateIndex
CREATE INDEX "Tournament_startDate_idx" ON "Tournament"("startDate");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");
